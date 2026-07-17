// Dominio puro — paciente: (de)serialización de tratamientos y del historial
// libre de sesiones. Sin dependencias de Firebase ni de React. Movido verbatim
// desde lib/helpers.ts (R1; ver docs/architecture.md → Observaciones #5/#6).
// La retrocompatibilidad con las formas legacy está documentada como tests en
// lib/domain/__tests__/paciente.test.ts.

import { Patient, Tratamiento } from "@/types"

// Sesión registrada en el historial libre: "N-" seguido de espacio o fin de
// texto. El lookahead evita falsos positivos con teléfonos ("02320-659087") o
// fechas ("2026-06-10") anotados en el mismo campo. Fuente única para contar y
// numerar sesiones (countSesionesEnHistorial / getNextSessionNumber).
const SESION_RE = /(\d+)-(?=\s|$)/g

/** Cuenta las sesiones "N-" registradas en el historial libre (esquema legacy). */
export function countSesionesEnHistorial(text: string): number {
  return [...text.matchAll(SESION_RE)].length
}

export function getNextSessionNumber(text: string): number {
  // Mismo criterio que countSesionesEnHistorial (ver SESION_RE): cuenta "N-"
  // reales, no fechas ni teléfonos anotados en el historial libre.
  const matches = [...text.matchAll(SESION_RE)]
  if (matches.length === 0) return 1
  return Math.max(...matches.map((m) => parseInt(m[1], 10))) + 1
}

export function appendSesionAlHistorial(historial: string, fechaHora: string): string {
  const entry = `${getNextSessionNumber(historial)}- ${fechaHora}`
  return historial.trim() ? `${historial.trim()}\n${entry}` : entry
}

export function parseTratamientosRaw(val: unknown): Tratamiento[] {
  if (!val) return []
  const items: unknown[] = Array.isArray(val) ? val : Object.values(val as object)
  return items.filter(Boolean).map((item) => {
    const t = item as Record<string, unknown>
    const rawSesiones = t.sesiones
    const sesiones: string[] = Array.isArray(rawSesiones)
      ? (rawSesiones as string[]).filter(Boolean)
      : rawSesiones && typeof rawSesiones === "object"
      ? (Object.values(rawSesiones as object) as string[]).filter(Boolean)
      : []
    return {
      id: String(t.id ?? Date.now()),
      nroAutorizacion: String(t.nroAutorizacion ?? ""),
      sesionesAutorizadas: Number(t.sesionesAutorizadas ?? 0),
      fechaCreacion: String(t.fechaCreacion ?? ""),
      sesiones,
      ...(t.tratamiento != null && { tratamiento: String(t.tratamiento) }),
      ...(t.diagnostico != null && { diagnostico: String(t.diagnostico) }),
      ...(t.doctor != null && { doctor: String(t.doctor) }),
    }
  })
}

// Sesiones usadas/autorizadas de un paciente: suma los tratamientos del acordeón,
// o cae al esquema legacy (sesionesAutorizadas + conteo de "N-" en el historial libre).
// null si el paciente no tiene sesiones autorizadas cargadas.
export function getSessionStats(patient: Patient): { used: number; authorized: number } | null {
  const trats = parseTratamientosRaw(patient.tratamientos)
  if (trats.length > 0) {
    const authorized = trats.reduce((sum, t) => sum + (t.sesionesAutorizadas ?? 0), 0)
    if (!authorized) return null
    const used = trats.reduce((sum, t) => sum + t.sesiones.length, 0)
    return { used, authorized }
  }
  const authorized = patient.sesionesAutorizadas
  if (!authorized) return null
  const sesionesText = (patient.sesiones ?? []).join(" ")
  const used = countSesionesEnHistorial(sesionesText)
  return { used, authorized }
}
