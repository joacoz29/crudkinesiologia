"use client"

import { useSyncExternalStore, useCallback } from "react"
import { ref, onValue, off } from "firebase/database"
import { onAuthStateChanged } from "firebase/auth"
import { db, auth } from "@/lib/firebase"
import { DiaNoLaborableManual, NoLaborable, noLaborableDe } from "@/lib/domain/no-laborables"

// Caché compartida de `config/diasNoLaborables`: UNA suscripción live para toda
// la app (calendario + modales de turno). El nodo es chico (unas decenas de
// fechas por año) y live refleja al instante lo que marca otro usuario.

type State = { manuales: Record<string, DiaNoLaborableManual>; isLoading: boolean }

let state: State = { manuales: {}, isLoading: true }
const listeners = new Set<() => void>()
let authUnsub: (() => void) | null = null
let dbOff: (() => void) | null = null

function setState(next: Partial<State>) {
  state = { ...state, ...next }
  for (const l of listeners) l()
}

function start() {
  if (authUnsub || typeof window === "undefined") return
  authUnsub = onAuthStateChanged(auth, (user) => {
    if (dbOff) { dbOff(); dbOff = null }
    if (!user) {
      setState({ manuales: {}, isLoading: false })
      return
    }
    const r = ref(db, "config/diasNoLaborables")
    const cb = onValue(
      r,
      (snap) => setState({ manuales: snap.val() ?? {}, isLoading: false }),
      () => setState({ isLoading: false }),
    )
    dbOff = () => off(r, "value", cb)
  })
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  start()
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      if (dbOff) { dbOff(); dbOff = null }
      if (authUnsub) { authUnsub(); authUnsub = null }
    }
  }
}

const getSnapshot = () => state

/** Días no laborables (anuales + manuales), live. `noLaborable(yyyy-MM-dd)` → motivo o null. */
export function useDiasNoLaborables() {
  const { manuales, isLoading } = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const noLaborable = useCallback(
    (fecha: string): NoLaborable | null => noLaborableDe(fecha, manuales),
    [manuales],
  )
  return { manuales, isLoading, noLaborable }
}
