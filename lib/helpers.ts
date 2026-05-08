import { ref, set, get, push, remove, update, query, orderByKey, startAt, endAt } from "firebase/database"
import { db, auth } from "@/lib/firebase"
import { Tratamiento, Turno, TurnoConFecha } from "@/types"
import { getUserDisplayName } from "@/lib/auth-helper"

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

interface LibroDiarioEntry {
  nombreApellido: string
  cobertura: "Particular" | "Obra Social"
  obraSocial: string
  debe: number
  haber: number
}

export async function addToLibroDiario(entry: {
  nombreApellido: string
  obraSocial: string
  fecha?: string
}) {
  const today = entry.fecha ?? new Date().toISOString().split('T')[0]
  const libroDiarioRef = ref(db, `libroDiario/${today}`)
  
  // Obtener entradas existentes
  const snapshot = await get(libroDiarioRef)
  const existingData = snapshot.exists() ? snapshot.val() : { entradas: [] }
  
  // Crear nueva entrada
  const newEntry: LibroDiarioEntry = {
    nombreApellido: entry.nombreApellido,
    cobertura: entry.obraSocial === "-" ? "Particular" : "Obra Social",
    obraSocial: entry.obraSocial,
    debe: 0,
    haber: 0,
  }
  
  // Skip if this patient already has an entry for this date
  const alreadyExists = (existingData.entradas || []).some(
    (e: LibroDiarioEntry) => e.nombreApellido === entry.nombreApellido
  )
  if (alreadyExists) return

  // Agregar nueva entrada al array existente
  const updatedEntradas = [...(existingData.entradas || []), newEntry]
  
  const totalHaber = updatedEntradas.reduce((sum, entrada) => sum + (entrada.haber || 0), 0)
  const totalDebe = updatedEntradas.reduce((sum, entrada) => sum + (entrada.debe || 0), 0)

  await set(libroDiarioRef, {
    fecha: new Date().toISOString(),
    entradas: updatedEntradas,
    totalHaber,
    totalDebe,
  })
}

export async function fetchTurnosPorMes(
  year: number,
  month: number
): Promise<Record<string, Turno[]>> {
  const pad = (n: number) => String(n).padStart(2, "0")
  const start = `${year}-${pad(month)}-01`
  const end = `${year}-${pad(month)}-31`

  const turnosQuery = query(
    ref(db, "turnos"),
    orderByKey(),
    startAt(start),
    endAt(end)
  )

  const snapshot = await get(turnosQuery)
  if (!snapshot.exists()) return {}

  const result: Record<string, Turno[]> = {}
  snapshot.forEach((dateSnap) => {
    const fecha = dateSnap.key!
    const entries: Turno[] = []
    dateSnap.forEach((turnoSnap) => {
      entries.push({ id: turnoSnap.key!, ...turnoSnap.val() } as Turno)
    })
    result[fecha] = entries.sort((a, b) => a.hora.localeCompare(b.hora))
  })
  return result
}

export async function saveTurno(
  fecha: string,
  turno: Omit<Turno, "id">
): Promise<string> {
  // Strip undefined fields — Firebase rejects them
  const clean = Object.fromEntries(
    Object.entries(turno).filter(([, v]) => v !== undefined)
  )
  try {
    const newRef = await push(ref(db, `turnos/${fecha}`), clean)
    return newRef.key!
  } catch (err) {
    console.error("[helpers.saveTurno] Firebase error:", err)
    throw err
  }
}

export async function updateTurno(
  fecha: string,
  id: string,
  data: Partial<Omit<Turno, "id">>
): Promise<void> {
  const clean = Object.fromEntries(
    Object.entries(data).filter(([, v]) => v !== undefined)
  )
  try {
    await update(ref(db, `turnos/${fecha}/${id}`), clean)
  } catch (err) {
    console.error("[helpers.updateTurno] Firebase error:", err)
    throw err
  }
}

export async function fetchTurnosPorPaciente(patientId: string): Promise<TurnoConFecha[]> {
  const pad = (n: number) => String(n).padStart(2, "0")
  const from = new Date(); from.setFullYear(from.getFullYear() - 2)
  const to = new Date(); to.setDate(to.getDate() + 180)
  const start = `${from.getFullYear()}-${pad(from.getMonth() + 1)}-${pad(from.getDate())}`
  const end = `${to.getFullYear()}-${pad(to.getMonth() + 1)}-${pad(to.getDate())}`

  const turnosQuery = query(ref(db, "turnos"), orderByKey(), startAt(start), endAt(end))
  const snapshot = await get(turnosQuery)
  if (!snapshot.exists()) return []

  const result: TurnoConFecha[] = []
  snapshot.forEach((dateSnap) => {
    const fecha = dateSnap.key!
    dateSnap.forEach((turnoSnap) => {
      const t = { id: turnoSnap.key!, ...turnoSnap.val() } as Turno
      if (t.patientId === patientId) result.push({ ...t, fecha })
    })
  })
  return result.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.hora.localeCompare(b.hora))
}

export async function deleteTurno(fecha: string, id: string): Promise<void> {
  try {
    await remove(ref(db, `turnos/${fecha}/${id}`))
  } catch (err) {
    console.error("[helpers.deleteTurno] Firebase error:", err)
    throw err
  }
}

export type LogAccion =
  | "crear_paciente"
  | "editar_paciente"
  | "eliminar_paciente"
  | "confirmar_asistencia"
  | "crear_turno"
  | "editar_turno"
  | "eliminar_turno"
  | "eliminar_todos_turnos"

export type LogCambio = Record<string, { antes: string; despues: string }>

export async function writeLog(entry: {
  accion: LogAccion
  detalle: string
  entidadId?: string
  cambios?: LogCambio
}): Promise<void> {
  const user = auth.currentUser
  if (!user) return
  const mes = new Date().toISOString().slice(0, 7)
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