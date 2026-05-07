import { ref, set, get, push, remove, update, query, orderByKey, startAt, endAt } from "firebase/database"
import { db } from "@/lib/firebase"
import { Turno, TurnoConFecha } from "@/types"

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
  
  // Agregar nueva entrada al array existente
  const updatedEntradas = [...(existingData.entradas || []), newEntry]
  
  // Calcular nuevo total
  const totalHaber = updatedEntradas.reduce((sum, entrada) => sum + (entrada.haber || 0), 0)
  
  // Guardar datos actualizados
  await set(libroDiarioRef, {
    fecha: new Date().toISOString(),
    entradas: updatedEntradas,
    totalHaber,
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
  const from = new Date(); from.setDate(from.getDate() - 30)
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