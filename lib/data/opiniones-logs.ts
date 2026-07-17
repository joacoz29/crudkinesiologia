// Acceso a datos — opiniones y logs por mes (compartidos entre las vistas del
// admin vía la misma caché de mes). Movido verbatim desde lib/helpers.ts (R2;
// ver docs/architecture.md → obs #6).

import { ref, get } from "firebase/database"
import { db } from "@/lib/firebase"
import { LogCambio } from "@/lib/audit/log"

export interface Opinion {
  id: string
  patientId: string
  nombre: string
  rating: number
  comentario?: string
  atendidoPor?: string
  fecha: string
}

// Opiniones de un mes (clave yyyy-MM), ordenadas por fecha desc.
// Compartido entre la vista Opiniones y la pestaña Datos (misma caché por mes).
export async function fetchOpinionesMes(mesKey: string): Promise<Opinion[]> {
  const snap = await get(ref(db, `opiniones/${mesKey}`))
  if (!snap.exists()) return []
  return Object.entries(snap.val() as Record<string, Omit<Opinion, "id">>)
    .map(([id, val]) => ({ id, ...val }))
    .sort((a, b) => b.fecha.localeCompare(a.fecha))
}

export interface LogEntry {
  id: string
  timestamp: string
  email: string
  displayName: string
  accion: string
  detalle: string
  entidadId?: string
  cambios?: LogCambio
}

// Logs de un mes (clave yyyy-MM), ordenados por timestamp desc.
// Compartido entre la vista Registro y la pestaña Datos (misma caché por mes).
export async function fetchLogsMes(mesKey: string): Promise<LogEntry[]> {
  const snap = await get(ref(db, `logs/${mesKey}`))
  if (!snap.exists()) return []
  return Object.entries(snap.val() as Record<string, Omit<LogEntry, "id">>)
    .map(([id, val]) => ({ id, ...val }))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
}
