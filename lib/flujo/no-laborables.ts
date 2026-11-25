// Escrituras de días no laborables y de la cancelación de turnos de un día cerrado.
// Todas multi-path atómicas y auditadas.

import { ref, get, update } from "firebase/database"
import { db, auth } from "@/lib/firebase"
import { getUserDisplayName } from "@/lib/auth-helper"
import { writeLog } from "@/lib/audit/log"
import { fechasEntre } from "@/lib/domain/no-laborables"
import { fetchTurnosPorRango } from "@/lib/data/turnos"
import { Turno } from "@/types"

const ddmm = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`

/** Marca el rango [desde, hasta] como no laborable. Devuelve cuántos turnos pendientes quedaron adentro. */
export async function marcarNoLaborable(desde: string, hasta: string, motivo: string) {
  const fechas = fechasEntre(desde, hasta)
  if (fechas.length === 0) throw new Error("RANGO_INVALIDO")
  const entry = { motivo, por: getUserDisplayName(auth.currentUser), creadoEn: Date.now() }
  const upd: Record<string, unknown> = {}
  for (const f of fechas) upd[`config/diasNoLaborables/${f}`] = entry
  await update(ref(db), upd)

  const rango = fechas.length === 1 ? ddmm(desde) : `${ddmm(desde)} al ${ddmm(hasta)}`
  await writeLog({ accion: "marcar_no_laborable", detalle: `Marcó como no laborable el ${rango} (${motivo})` })

  const turnos = await fetchTurnosPorRango(desde, hasta)
  const pendientes = Object.values(turnos).flat().filter((t) => t.estado === "pendiente").length
  return { dias: fechas.length, pendientes }
}

export async function quitarNoLaborable(fecha: string, motivo: string) {
  await update(ref(db), { [`config/diasNoLaborables/${fecha}`]: null })
  await writeLog({ accion: "quitar_no_laborable", detalle: `Volvió a habilitar el ${ddmm(fecha)} (era: ${motivo})` })
}

/**
 * Cancela todos los turnos pendientes del día (todas las especialidades: el
 * consultorio está cerrado). Relee el día para no pisar cambios recientes.
 */
export async function cancelarPendientesDelDia(fecha: string) {
  const snap = await get(ref(db, `turnos/${fecha}`))
  const val = (snap.val() ?? {}) as Record<string, Omit<Turno, "id">>
  const ids = Object.entries(val).filter(([, t]) => t.estado === "pendiente").map(([id]) => id)
  if (ids.length === 0) return { cancelados: 0, revert: null }

  const upd: Record<string, unknown> = {}
  const revert: Record<string, unknown> = {}
  for (const id of ids) {
    upd[`turnos/${fecha}/${id}/estado`] = "cancelado"
    revert[`turnos/${fecha}/${id}/estado`] = "pendiente"
  }
  await update(ref(db), upd)
  await writeLog({ accion: "cancelar_turnos_dia", detalle: `Canceló ${ids.length} turno${ids.length !== 1 ? "s" : ""} pendiente${ids.length !== 1 ? "s" : ""} del ${ddmm(fecha)} (día no laborable)` })
  return { cancelados: ids.length, revert }
}

export async function deshacerCancelarPendientes(revert: Record<string, unknown>, fecha: string) {
  await update(ref(db), revert)
  const n = Object.keys(revert).length
  await writeLog({ accion: "deshacer_cancelar_turnos", detalle: `Deshizo la cancelación de ${n} turno${n !== 1 ? "s" : ""} del ${ddmm(fecha)}` })
}
