// Avisos diarios de Anita para recepción: solo lo accionable de HOY (y mañana),
// derivado en memoria de datos ya cargados. Puro y testeable.
//
// Prioridad: reautorizar antes del turno → día cerrado con turnos pendientes →
// datos incompletos de quien viene hoy → turnos de hoy sin marcar (fin de la
// tarde) → datos incompletos de quien viene mañana.

import { Patient, Turno } from "@/types"
import { getSessionStats } from "@/lib/domain/paciente"
import { horaToMin } from "@/lib/domain/tiempo"
import { camposFaltantes } from "@/lib/tareas"

export type AvisoAccion = { tipo: "ficha"; patientId: string } | { tipo: "calendario"; fecha: string }

export interface AvisoRecepcion {
  /** Estable por día/entidad: permite recordar cuáles ya se vieron */
  id: string
  tipo: "reautorizar" | "cierre" | "datos" | "sin_marcar"
  texto: string
  accion: AvisoAccion
}

export interface CierreConPendientes {
  fecha: string
  motivo: string
  pendientes: number
}

/** Desde esta hora (AR) se avisa de los turnos de hoy que siguen sin marcar */
export const HORA_AVISO_SIN_MARCAR = 17 * 60

const nombre = (t: { nombre?: string; apellido?: string }) => `${t.nombre ?? ""} ${t.apellido ?? ""}`.trim()
const ddmm = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`
const listar = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`)

export function computeAvisosRecepcion(input: {
  patients: Patient[]
  /** Turnos de hoy y mañana (todas las especialidades) */
  turnosPorFecha: Record<string, Turno[]>
  hoyKey: string
  mananaKey: string
  nowMin: number
  cierres: CierreConPendientes[]
}): AvisoRecepcion[] {
  const { patients, turnosPorFecha, hoyKey, mananaKey, nowMin, cierres } = input
  const porId = new Map(patients.map((p) => [p.id, p]))

  const reautorizar: AvisoRecepcion[] = []
  const datosHoy: AvisoRecepcion[] = []
  const datosManana: AvisoRecepcion[] = []
  const vistos = new Set<string>()

  for (const fecha of [hoyKey, mananaKey]) {
    const turnos = [...(turnosPorFecha[fecha] ?? [])]
      .filter((t) => t.estado !== "cancelado" && t.patientId)
      .sort((a, b) => a.hora.localeCompare(b.hora))
    const cuando = fecha === hoyKey ? "Hoy" : "Mañana"
    for (const t of turnos) {
      const p = porId.get(t.patientId!)
      if (!p || vistos.has(p.id)) continue // si viene hoy y mañana, alcanza con un aviso
      vistos.add(p.id)

      const stats = getSessionStats(p)
      if (stats && stats.used >= stats.authorized) {
        reautorizar.push({
          id: `reautorizar:${p.id}:${fecha}`,
          tipo: "reautorizar",
          texto: `${cuando} ${t.hora} viene ${nombre(p)} y agotó sus sesiones (${stats.used}/${stats.authorized}): hay que reautorizar.`,
          accion: { tipo: "ficha", patientId: p.id },
        })
      }

      const faltan = camposFaltantes(p)
      if (faltan.length > 0) {
        ;(fecha === hoyKey ? datosHoy : datosManana).push({
          id: `datos:${p.id}:${fecha}`,
          tipo: "datos",
          texto: `${cuando} ${t.hora} viene ${nombre(p)}: pedile ${listar(faltan)}.`,
          accion: { tipo: "ficha", patientId: p.id },
        })
      }
    }
  }

  const cierreAvisos: AvisoRecepcion[] = cierres
    .filter((c) => c.pendientes > 0)
    .sort((a, b) => a.fecha.localeCompare(b.fecha))
    .map((c) => ({
      id: `cierre:${c.fecha}:${c.pendientes}`,
      tipo: "cierre",
      texto: `El ${ddmm(c.fecha)} está cerrado (${c.motivo}) y ${c.pendientes === 1 ? "queda 1 turno pendiente" : `quedan ${c.pendientes} turnos pendientes`}: avisales y cancelalos o reprogramalos.`,
      accion: { tipo: "calendario", fecha: c.fecha },
    }))

  const sinMarcar: AvisoRecepcion[] = []
  if (nowMin >= HORA_AVISO_SIN_MARCAR) {
    const n = (turnosPorFecha[hoyKey] ?? []).filter((t) => t.estado === "pendiente" && horaToMin(t.hora) < nowMin).length
    if (n > 0) {
      sinMarcar.push({
        id: `sin_marcar:${hoyKey}`,
        tipo: "sin_marcar",
        texto: n === 1 ? "Queda 1 turno de hoy sin marcar asistencia." : `Quedan ${n} turnos de hoy sin marcar asistencia.`,
        accion: { tipo: "calendario", fecha: hoyKey },
      })
    }
  }

  return [...reautorizar, ...cierreAvisos, ...datosHoy, ...sinMarcar, ...datosManana]
}
