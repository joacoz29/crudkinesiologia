import { ref, get, push, remove, update, query, orderByKey, startAt, endAt } from "firebase/database"
import { format } from "date-fns-tz"
import { db, auth } from "@/lib/firebase"
import { Patient, Tratamiento, Turno, TurnoConFecha } from "@/types"
import { getUserDisplayName } from "@/lib/auth-helper"

const TZ = "America/Argentina/Buenos_Aires"

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
  const used = [...sesionesText.matchAll(/\d+-/g)].length
  return { used, authorized }
}

export interface LibroDiarioEntry {
  id?: string
  tipo?: "Paciente" | "Gasto" | "Ingreso"
  nombreApellido: string
  cobertura: "Particular" | "Obra Social"
  obraSocial: string
  debe: number
  haber: number
}

// Normaliza las entradas del libro diario soportando ambos formatos:
// - array (legacy: se guardaba el nodo entero) → id = inner `id`
// - mapa { entryId: entry } (nuevo: escrituras por-entrada) → id = la clave
// La clave manda en el formato mapa: es la identidad estable para los updates.
export function normalizeLibroEntradas(raw: unknown): (LibroDiarioEntry & { id: string })[] {
  if (!raw) return []
  const entries: (LibroDiarioEntry & { id: string })[] = []
  if (Array.isArray(raw)) {
    for (const e of raw) {
      if (!e) continue
      const v = e as LibroDiarioEntry
      entries.push({ ...v, id: v.id || (typeof crypto !== "undefined" ? crypto.randomUUID() : String(Math.random())), tipo: v.tipo ?? "Paciente" })
    }
  } else if (typeof raw === "object") {
    for (const [key, val] of Object.entries(raw as Record<string, LibroDiarioEntry>)) {
      if (!val) continue
      entries.push({ ...val, id: key, tipo: val.tipo ?? "Paciente" })
    }
  }
  return entries
}

// Prepara UNA entrada de paciente para el libro diario del día, o null si el
// paciente ya tiene entrada ese día. Devuelve solo la entrada + su id para
// escribirla de forma puntual (`entradas/{id}`), sin tocar las demás entradas
// (evita el lost-update con quien esté editando el libro en simultáneo).
async function buildLibroDiarioEntry(
  dateKey: string,
  nombreApellido: string,
  obraSocial: string
): Promise<{ entryId: string; entry: LibroDiarioEntry } | null> {
  const snapshot = await get(ref(db, `libroDiario/${dateKey}/entradas`))
  const entradas = normalizeLibroEntradas(snapshot.val())

  // Skip if this patient already has an entry for this date
  if (entradas.some((e) => e.nombreApellido === nombreApellido)) return null

  const entryId = crypto.randomUUID()
  const entry: LibroDiarioEntry = {
    id: entryId,
    tipo: "Paciente",
    nombreApellido,
    cobertura: obraSocial === "-" ? "Particular" : "Obra Social",
    obraSocial,
    debe: 0,
    haber: 0,
  }
  return { entryId, entry }
}

export async function addToLibroDiario(entry: {
  nombreApellido: string
  obraSocial: string
  fecha?: string
}) {
  // Fecha local de Argentina, no UTC (toISOString cae en "mañana" después de las 21:00)
  const dateKey = entry.fecha ?? format(new Date(), "yyyy-MM-dd", { timeZone: TZ })
  const result = await buildLibroDiarioEntry(dateKey, entry.nombreApellido, entry.obraSocial)
  if (!result) return
  await update(ref(db), {
    [`libroDiario/${dateKey}/fecha`]: dateKey,
    [`libroDiario/${dateKey}/entradas/${result.entryId}`]: result.entry,
  })
}

export async function fetchTurnosPorRango(
  start: string,
  end: string
): Promise<Record<string, Turno[]>> {
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

export interface LibroResumen {
  porDia: Record<string, { haber: number; debe: number }>
  // Desglose de la recaudación (haber) y egresos (debe) del rango
  haberParticular: number // pacientes Particular
  haberObraSocial: number // pacientes con Obra Social
  haberIngreso: number    // entradas tipo Ingreso
  debeGasto: number       // entradas tipo Gasto
}

// Resumen del libro diario en un rango (claves yyyy-MM-dd): haber/debe por día
// + desglose por cobertura/tipo. Computa todo en una sola lectura sumando las
// entradas (los totales denormalizados se dropearon).
export async function fetchLibroDiarioPorRango(
  start: string,
  end: string
): Promise<LibroResumen> {
  const q = query(ref(db, "libroDiario"), orderByKey(), startAt(start), endAt(end))
  const snapshot = await get(q)

  const porDia: Record<string, { haber: number; debe: number }> = {}
  let haberParticular = 0
  let haberObraSocial = 0
  let haberIngreso = 0
  let debeGasto = 0

  if (snapshot.exists()) {
    snapshot.forEach((daySnap) => {
      const fecha = daySnap.key!
      const entradas = normalizeLibroEntradas((daySnap.val() as { entradas?: unknown })?.entradas)
      let haber = 0
      let debe = 0
      for (const e of entradas) {
        const h = Number(e.haber) || 0
        const d = Number(e.debe) || 0
        haber += h
        debe += d
        const tipo = e.tipo ?? "Paciente"
        if (tipo === "Ingreso") haberIngreso += h
        else if (tipo === "Gasto") debeGasto += d
        else if (e.cobertura === "Obra Social") haberObraSocial += h
        else haberParticular += h
      }
      porDia[fecha] = { haber, debe }
    })
  }
  return { porDia, haberParticular, haberObraSocial, haberIngreso, debeGasto }
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

// Agrega una entrada "N- dd/mm/yyyy HH:mm" al historial libre, con numeración
// correlativa — mismo formato que usa confirmarAsistencia
export function appendSesionAlHistorial(historial: string, fechaHora: string): string {
  const entry = `${getNextSessionNumber(historial)}- ${fechaHora}`
  return historial.trim() ? `${historial.trim()}\n${entry}` : entry
}

export function getNextSessionNumber(text: string): number {
  // Solo "N-" seguido de espacio o fin de texto: evita falsos positivos con
  // teléfonos ("02320-659087") o fechas ("2026-06-10") anotados en el historial
  const matches = [...text.matchAll(/(\d+)-(?=\s|$)/g)]
  if (matches.length === 0) return 1
  return Math.max(...matches.map((m) => parseInt(m[1], 10))) + 1
}

export interface ConfirmarAsistenciaResult {
  alreadyConfirmed: boolean
  nextNum?: number
  /** Sesiones restantes del último tratamiento, o null si el paciente no tiene tratamientos */
  remaining?: number | null
  /** Payload multi-path para revertir la confirmación con desconfirmarAsistencia */
  revert?: Record<string, unknown>
}

// Confirma la asistencia de un turno: registra la sesión en el historial del paciente,
// la sincroniza al último tratamiento, marca el turno como asistido y lo agrega al
// libro diario — todo en UNA escritura multi-path (atómica: o se aplica todo o nada).
export async function confirmarAsistencia(params: {
  patientId: string
  turnoId: string
  fecha: string // yyyy-MM-dd
  hora: string
  nombre: string
  apellido: string
}): Promise<ConfirmarAsistenciaResult> {
  const { patientId, turnoId, fecha, hora, nombre, apellido } = params

  // Guard de idempotencia: si otro usuario ya lo confirmó, no duplicar la sesión
  const turnoSnap = await get(ref(db, `turnos/${fecha}/${turnoId}`))
  if (!turnoSnap.exists()) throw new Error("TURNO_NO_ENCONTRADO")
  const estadoPrevio = (turnoSnap.val() as Turno).estado
  if (estadoPrevio === "asistio") return { alreadyConfirmed: true }

  const snap = await get(ref(db, `pacientes/${patientId}`))
  if (!snap.exists()) throw new Error("PACIENTE_NO_ENCONTRADO")
  const raw = snap.val() as Record<string, unknown>

  const rawSesiones = raw.sesiones
  const sesionesActual =
    Array.isArray(rawSesiones) ? (rawSesiones as string[]).join(" ")
    : rawSesiones && typeof rawSesiones === "object"
    ? Object.values(rawSesiones as Record<string, string>).join(" ")
    : typeof rawSesiones === "string" ? rawSesiones : ""

  const [year, month, day] = fecha.split("-")
  const nextNum = getNextSessionNumber(sesionesActual)
  const newEntry = `${nextNum}- ${day}/${month}/${year} ${hora}`
  const updatedSesiones = sesionesActual.trim() ? `${sesionesActual.trim()}\n${newEntry}` : newEntry

  const updates: Record<string, unknown> = {
    [`pacientes/${patientId}/sesiones`]: [updatedSesiones],
    [`pacientes/${patientId}/ultima_actualizacion`]: {
      fecha: new Date().toISOString(),
      usuario: auth.currentUser?.displayName || auth.currentUser?.email || "Calendario",
    },
    [`turnos/${fecha}/${turnoId}/estado`]: "asistio",
  }
  const revert: Record<string, unknown> = {
    [`pacientes/${patientId}/sesiones`]: rawSesiones ?? null,
    [`pacientes/${patientId}/ultima_actualizacion`]: raw.ultima_actualizacion ?? null,
    [`turnos/${fecha}/${turnoId}/estado`]: estadoPrevio,
  }

  const tratamientos = parseTratamientosRaw(raw.tratamientos)
  let remaining: number | null = null
  if (tratamientos.length > 0) {
    const latest = tratamientos[tratamientos.length - 1]
    const sessionEntry = `Sesión ${latest.sesiones.length + 1} — ${day}/${month}/${year} ${hora}`
    updates[`pacientes/${patientId}/tratamientos`] = tratamientos.map((t, i) =>
      i === tratamientos.length - 1 ? { ...t, sesiones: [...t.sesiones, sessionEntry] } : t
    )
    revert[`pacientes/${patientId}/tratamientos`] = raw.tratamientos ?? null
    remaining = latest.sesionesAutorizadas - (latest.sesiones.length + 1)
  }

  const libro = await buildLibroDiarioEntry(fecha, `${nombre} ${apellido}`, (raw.obraSocial as string) || "-")
  if (libro) {
    // Escritura puntual de la entrada (no pisa otras entradas del día); el revert
    // solo borra la entrada agregada
    updates[`libroDiario/${fecha}/fecha`] = fecha
    updates[`libroDiario/${fecha}/entradas/${libro.entryId}`] = libro.entry
    revert[`libroDiario/${fecha}/entradas/${libro.entryId}`] = null
  }

  await update(ref(db), updates)

  await writeLog({
    accion: "confirmar_asistencia",
    detalle: `Confirmó asistencia de ${nombre} ${apellido} (${fecha} ${hora})`,
    entidadId: patientId,
  })

  return { alreadyConfirmed: false, nextNum, remaining, revert }
}

export async function desconfirmarAsistencia(
  revert: Record<string, unknown>,
  info: { patientId: string; nombre: string; apellido: string; fecha: string; hora: string }
): Promise<void> {
  await update(ref(db), revert)
  await writeLog({
    accion: "deshacer_asistencia",
    detalle: `Deshizo la asistencia de ${info.nombre} ${info.apellido} (${info.fecha} ${info.hora})`,
    entidadId: info.patientId,
  })
}

export type LogAccion =
  | "crear_paciente"
  | "editar_paciente"
  | "eliminar_paciente"
  | "confirmar_asistencia"
  | "deshacer_asistencia"
  | "crear_turno"
  | "editar_turno"
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