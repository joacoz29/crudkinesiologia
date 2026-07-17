import { ref, update } from "firebase/database"
import { db } from "@/lib/firebase"
import { Patient } from "@/types"
import { soloDigitos, dniEsValido } from "@/lib/tareas"
import { fetchTurnosPorPaciente } from "@/lib/data/turnos"
import { writeLog } from "@/lib/audit/log"

// Depuración de pacientes duplicados (mismo DNI VÁLIDO en 2+ fichas). Ver el
// análisis con scripts/dni-audit.mjs. La fusión es asistida (el admin revisa
// cada grupo y elige cuál conservar) porque algunos "duplicados" son en realidad
// dos personas distintas con el DNI mal tipeado.

export interface GrupoDuplicado {
  dni: string
  pacientes: Patient[]
}

/** Grupos de pacientes que comparten un DNI válido (candidatos a fusionar). */
export function gruposDuplicados(patients: Patient[]): GrupoDuplicado[] {
  const byDni = new Map<string, Patient[]>()
  for (const p of patients) {
    const d = soloDigitos(p.dni)
    if (!d || !dniEsValido(d)) continue // vacíos/relleno no son duplicados reales
    const arr = byDni.get(d)
    if (arr) arr.push(p)
    else byDni.set(d, [p])
  }
  const grupos: GrupoDuplicado[] = []
  for (const [dni, pacientes] of byDni) {
    if (pacientes.length > 1) grupos.push({ dni, pacientes })
  }
  // Más registros primero (los peores), luego por DNI para orden estable
  return grupos.sort((a, b) => b.pacientes.length - a.pacientes.length || a.dni.localeCompare(b.dni))
}

const nombreDe = (p: Patient) => `${p.nombre ?? ""} ${p.apellido ?? ""}`.trim() || "(sin nombre)"
const historialDe = (p: Patient): string =>
  (Array.isArray(p.sesiones) ? p.sesiones.join("\n") : String(p.sesiones ?? "")).trim()

/**
 * Fusiona varias fichas duplicadas en una (`keep`):
 *  - concatena el historial/sesiones de las descartadas al final del de `keep`
 *    (con un encabezado, para NO perder ninguna sesión),
 *  - concatena los tratamientos,
 *  - reasigna los turnos de las descartadas a `keep` (patientId + nombre/apellido),
 *  - borra las fichas descartadas.
 * Todo en UNA escritura multi-path atómica. Devuelve `revert` para el Deshacer.
 */
export async function fusionarPacientes(
  keep: Patient,
  drops: Patient[],
): Promise<{ revert: Record<string, unknown> }> {
  const updates: Record<string, unknown> = {}
  const revert: Record<string, unknown> = {}

  // Historial combinado (no se pierde nada)
  const partes = [historialDe(keep)]
  for (const d of drops) {
    const h = historialDe(d)
    if (h) partes.push(`--- fusionado de ${nombreDe(d)} (DNI ${soloDigitos(d.dni)}) ---\n${h}`)
  }
  const mergedHist = partes.filter(Boolean).join("\n")
  updates[`pacientes/${keep.id}/sesiones`] = [mergedHist]
  revert[`pacientes/${keep.id}/sesiones`] = keep.sesiones ?? null

  // Tratamientos combinados
  const keepTrats = Array.isArray(keep.tratamientos) ? keep.tratamientos : []
  const dropTrats = drops.flatMap((d) => (Array.isArray(d.tratamientos) ? d.tratamientos : []))
  if (dropTrats.length > 0) {
    updates[`pacientes/${keep.id}/tratamientos`] = [...keepTrats, ...dropTrats]
    revert[`pacientes/${keep.id}/tratamientos`] = keep.tratamientos ?? null
  }

  // Reasignar turnos de cada descartada → keep, y borrar la ficha descartada
  for (const d of drops) {
    const turnos = await fetchTurnosPorPaciente(d.id) // por patientId (rango -2a..+180d)
    for (const t of turnos) {
      const base = `turnos/${t.fecha}/${t.id}`
      updates[`${base}/patientId`] = keep.id
      updates[`${base}/nombre`] = keep.nombre
      updates[`${base}/apellido`] = keep.apellido
      revert[`${base}/patientId`] = t.patientId ?? null
      revert[`${base}/nombre`] = t.nombre
      revert[`${base}/apellido`] = t.apellido
    }
    // Restaurar la ficha completa (sin la clave id) en el revert antes de borrarla
    const { id: _omit, ...fichaSinId } = d
    void _omit
    updates[`pacientes/${d.id}`] = null
    revert[`pacientes/${d.id}`] = fichaSinId
  }

  await update(ref(db), updates)

  await writeLog({
    accion: "fusionar_pacientes",
    detalle: `Fusionó ${drops.length + 1} fichas en ${nombreDe(keep)} (DNI ${soloDigitos(keep.dni)}, ${drops.length} descartada${drops.length !== 1 ? "s" : ""})`,
    entidadId: keep.id,
  })

  return { revert }
}

/** Revierte una fusión (restaura fichas borradas y la reasignación de turnos). */
export async function deshacerFusion(
  revert: Record<string, unknown>,
  info: { nombre: string; entidadId: string },
): Promise<void> {
  await update(ref(db), revert)
  await writeLog({
    accion: "deshacer_fusion",
    detalle: `Deshizo la fusión de ${info.nombre}`,
    entidadId: info.entidadId,
  })
}
