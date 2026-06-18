"use client"

import { useSyncExternalStore } from "react"
import { ref, onValue, off, DataSnapshot } from "firebase/database"
import { onAuthStateChanged } from "firebase/auth"
import { db, auth } from "@/lib/firebase"
import { Patient } from "@/types"

// Caché compartida de la colección `pacientes`.
//
// Mantiene UNA sola suscripción `onValue` a `pacientes` para toda la app: la
// primera carga baja todo, y Firebase sincroniza solo los deltas en cada cambio
// (mucho más barato que re-descargar la colección entera por cada búsqueda,
// paginación o montaje, como hacíamos contra /api/patients).
//
// Al ser live no necesita invalidación manual: cualquier escritura a
// `pacientes/*` (crear, editar, eliminar, confirmar asistencia, sesiones del
// acordeón) se refleja automáticamente, incluso si la hace otro usuario.

type State = {
  patients: Patient[]
  isLoading: boolean
  error: string | null
}

let state: State = { patients: [], isLoading: true, error: null }

const listeners = new Set<() => void>()
let started = false
let authUnsub: (() => void) | null = null
let dbOff: (() => void) | null = null

function emit() {
  for (const l of listeners) l()
}

function setState(next: Partial<State>) {
  state = { ...state, ...next }
  emit()
}

// Normaliza `sesiones` legacy guardadas como string (formato histórico: "a, b, c")
function normalize(val: Record<string, Record<string, unknown>> | null): Patient[] {
  if (!val) return []
  return Object.entries(val).map(([id, raw]) => {
    const sesiones = Array.isArray(raw.sesiones)
      ? (raw.sesiones as string[])
      : typeof raw.sesiones === "string"
        ? (raw.sesiones as string).split(", ").filter(Boolean)
        : []
    return { ...raw, id, sesiones } as unknown as Patient
  })
}

function start() {
  if (started || typeof window === "undefined") return
  started = true
  // Esperar a la autenticación: las reglas RTDB rechazan el listen sin sesión.
  // Si el usuario cambia (logout/login), se reengancha la suscripción.
  authUnsub = onAuthStateChanged(auth, (user) => {
    if (dbOff) { dbOff(); dbOff = null }
    if (!user) {
      // Sin sesión: limpiar datos médicos de memoria
      setState({ patients: [], isLoading: false, error: null })
      return
    }
    setState({ isLoading: true, error: null })
    const r = ref(db, "pacientes")
    const cb = onValue(
      r,
      (snap: DataSnapshot) =>
        setState({ patients: normalize(snap.val()), isLoading: false, error: null }),
      (err: Error) => setState({ isLoading: false, error: err.message }),
    )
    dbOff = () => off(r, "value", cb)
  })
}

function stop() {
  if (dbOff) { dbOff(); dbOff = null }
  if (authUnsub) { authUnsub(); authUnsub = null }
  started = false
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  start()
  return () => {
    listeners.delete(listener)
    // La suscripción se mantiene viva entre navegaciones de pestaña para no
    // re-sincronizar cada vez. Solo se corta cuando no queda ningún consumidor.
    if (listeners.size === 0) stop()
  }
}

function getSnapshot(): State {
  return state
}

/** Hook reactivo: devuelve la colección completa de pacientes (live). */
export function usePatients(): State {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/**
 * Filtra, ordena y pagina en memoria. Replica exactamente lo que hacía
 * /api/patients (búsqueda por nombre/apellido/dni, orden por nombre).
 */
export function queryPatients(
  all: Patient[],
  opts: { search?: string; page?: number; limit?: number },
): { patients: Patient[]; pagination: { currentPage: number; totalPages: number; totalItems: number } } {
  const { search = "", page = 1, limit = 10 } = opts

  let filtered = all
  if (search) {
    const s = search.toLowerCase()
    // Solo tratamos la búsqueda como DNI cuando son dígitos y separadores
    // ("12.345.678", "12 345 678"…). Así un término mixto como "a1" no termina
    // matcheando a todos los pacientes que tengan un 1 en el DNI.
    const sDigits = /^[\d.\s-]+$/.test(s) ? s.replace(/\D/g, "") : ""
    filtered = all.filter((p) => {
      // `dni` puede venir como número en registros legacy: normalizar a string
      // antes de comparar. Un `p.dni?.toLowerCase()` directo tira TypeError sobre
      // un number (el `?.` solo corta null/undefined) y rompía toda la búsqueda.
      const dni = String(p.dni ?? "").toLowerCase()
      return (
        p.nombre?.toLowerCase().includes(s) ||
        p.apellido?.toLowerCase().includes(s) ||
        dni.includes(s) ||
        // Permite buscar "12.345.678" contra un DNI guardado como "12345678"
        (sDigits !== "" && dni.replace(/\D/g, "").includes(sDigits))
      )
    })
  }

  const sorted = [...filtered].sort((a, b) => a.nombre.localeCompare(b.nombre))
  const totalItems = sorted.length
  const totalPages = Math.ceil(totalItems / limit)
  const startIndex = (page - 1) * limit

  return {
    patients: sorted.slice(startIndex, startIndex + limit),
    pagination: { currentPage: page, totalPages, totalItems },
  }
}
