// Auditoría — writeLog y su vocabulario de acciones. Movido verbatim desde
// lib/helpers.ts (R2; ver docs/architecture.md → obs #6). Toda mutación de
// negocio del cliente pasa por acá (best-effort: nunca rompe el flujo principal).

import { ref, push } from "firebase/database"
import { format } from "date-fns-tz"
import { db, auth } from "@/lib/firebase"
import { getUserDisplayName } from "@/lib/auth-helper"
import { TZ } from "@/lib/domain/tiempo"

export type LogAccion =
  | "crear_paciente"
  | "editar_paciente"
  | "editar_traumatologia"
  | "eliminar_paciente"
  | "fusionar_pacientes"
  | "deshacer_fusion"
  | "confirmar_asistencia"
  | "deshacer_asistencia"
  | "marcar_ausente"
  | "deshacer_ausente"
  | "crear_turno"
  | "editar_turno"
  | "reprogramar_turno"
  | "eliminar_turno"
  | "eliminar_todos_turnos"
  | "deshacer_eliminar_turnos"
  | "editar_libro_diario"
  | "eliminar_entrada_libro"
  | "login"
  | "logout"

export type LogCambio = Record<string, { antes: string; despues: string }>

export async function writeLog(entry: {
  accion: LogAccion
  detalle: string
  entidadId?: string
  cambios?: LogCambio
}): Promise<void> {
  const user = auth.currentUser
  if (!user) return
  // Mes local de Argentina, no UTC (toISOString cae en el mes siguiente después de las 21:00 del último día)
  const mes = format(new Date(), "yyyy-MM", { timeZone: TZ })
  try {
    await push(ref(db, `logs/${mes}`), {
      timestamp: new Date().toISOString(),
      email: user.email ?? "desconocido",
      displayName: getUserDisplayName(user),
      accion: entry.accion,
      detalle: entry.detalle,
      ...(entry.entidadId && { entidadId: entry.entidadId }),
      ...(entry.cambios && Object.keys(entry.cambios).length > 0 && { cambios: entry.cambios }),
    })
  } catch {
    // logs nunca deben romper el flujo principal
  }
}
