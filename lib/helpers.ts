import { ref, get, push, update, query, orderByKey, startAt, endAt } from "firebase/database"
import { format } from "date-fns-tz"
import { db, auth } from "@/lib/firebase"
import { Patient, Tratamiento, Turno, TurnoConFecha, TurnoEstado, Especialidad, TraumatologiaFicha, TraumatologiaConsulta } from "@/types"
import { getUserDisplayName } from "@/lib/auth-helper"

const TZ = "America/Argentina/Buenos_Aires"

// Sesión registrada en el historial libre: "N-" seguido de espacio o fin de
// texto. El lookahead evita falsos positivos con teléfonos ("02320-659087") o
// fechas ("2026-06-10") anotados en el mismo campo. Fuente única para contar y
// numerar sesiones (countSesionesEnHistorial / getNextSessionNumber).
const SESION_RE = /(\d+)-(?=\s|$)/g

/** Cuenta las sesiones "N-" registradas en el historial libre (esquema legacy). */
export function countSesionesEnHistorial(text: string): number {
  return [...text.matchAll(SESION_RE)].length
}

// Hora "HH:MM" → minutos del día, y viceversa (para ventanas horarias)
export function horaToMin(h: string): number {
  const [hh, mm] = (h ?? "").split(":")
  return (parseInt(hh, 10) || 0) * 60 + (parseInt(mm, 10) || 0)
}
export function minToHora(m: number): string {
  const c = Math.max(0, Math.min(24 * 60 - 1, m))
  return `${String(Math.floor(c / 60)).padStart(2, "0")}:${String(c % 60).padStart(2, "0")}`
}

// Un turno pertenece a una especialidad. Los turnos legacy sin `especialidad` se
// tratan como kinesiología (retrocompat).
export function esDeEspecialidad(t: { especialidad?: Especialidad }, esp: Especialidad): boolean {
  return esp === "traumatologia"
    ? t.especialidad === "traumatologia"
    : (t.especialidad ?? "kinesiologia") === "kinesiologia"
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

function normalizeConsultaTrauma(item: unknown): TraumatologiaConsulta {
  const c = item as Record<string, unknown>
  return {
    id: String(c.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    fecha: String(c.fecha ?? ""),
    ...(!!(c.diagnostico != null && String(c.diagnostico).trim()) && { diagnostico: String(c.diagnostico) }),
    notas: String(c.notas ?? ""),
    // Preservar el monto es crítico: las escrituras reescriben la lista completa
    // desde el estado parseado — si se cayera acá, se perdería en la base.
    ...(Number(c.monto) > 0 && { monto: Number(c.monto) }),
    usuario: String(c.usuario ?? ""),
    createdAt: Number(c.createdAt ?? 0),
  }
}

// Historial de consultas de traumatología, más nuevas primero. Acepta la lista
// como array u objeto (retrocompat RTDB) y pliega el formato legacy plano
// ({diagnostico, notas} sueltos) como una consulta, para no perder lo ya cargado.
export function parseConsultasTrauma(ficha: TraumatologiaFicha | undefined | null): TraumatologiaConsulta[] {
  if (!ficha) return []
  const raw: unknown = ficha.consultas
  let list: TraumatologiaConsulta[] = []
  if (Array.isArray(raw)) list = raw.filter(Boolean).map(normalizeConsultaTrauma)
  else if (raw && typeof raw === "object") list = Object.values(raw as object).filter(Boolean).map(normalizeConsultaTrauma)
  if (list.length === 0 && ((ficha.diagnostico ?? "").trim() || (ficha.notas ?? "").trim())) {
    list = [{
      id: "legacy",
      fecha: (ficha.ultima_actualizacion?.fecha ?? "").slice(0, 10),
      ...(!!(ficha.diagnostico ?? "").trim() && { diagnostico: String(ficha.diagnostico) }),
      notas: (ficha.notas ?? "").trim(),
      usuario: ficha.ultima_actualizacion?.usuario ?? "",
      createdAt: 0,
    }]
  }
  return list.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
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

export interface LibroDiarioEntry {
  id?: string
  tipo?: "Paciente" | "Gasto" | "Ingreso"
  nombreApellido: string
  cobertura: "Particular" | "Obra Social"
  obraSocial: string
  detalle?: string
  debe: number
  haber: number
  // Sello de creación (epoch ms) para ordenar la lista por orden de carga. Las
  // claves bajo `entradas/` son uuids aleatorios, así que sin esto Firebase las
  // devuelve ordenadas por uuid (azaroso), no por cuándo se agregaron.
  createdAt?: number
  especialidad?: Especialidad // ausente = kinesiología (retrocompat)
}

// Normaliza las entradas del libro diario soportando ambos formatos:
// - array (legacy: se guardaba el nodo entero) → id = inner `id`
// - mapa { entryId: entry } (nuevo: escrituras por-entrada) → id = la clave
// La clave manda en el formato mapa: es la identidad estable para los updates.
export function normalizeLibroEntradas(raw: unknown): (LibroDiarioEntry & { id: string })[] {
  if (!raw) return []
  const entries: (LibroDiarioEntry & { id: string })[] = []
  if (Array.isArray(raw)) {
    raw.forEach((e, i) => {
      if (!e) return
      const v = e as LibroDiarioEntry
      entries.push({
        ...v,
        id: v.id || (typeof crypto !== "undefined" ? crypto.randomUUID() : String(Math.random())),
        tipo: v.tipo ?? "Paciente",
        // Formato legacy sin sello: el índice del array ES el orden de carga
        createdAt: typeof v.createdAt === "number" ? v.createdAt : i,
      })
    })
  } else if (typeof raw === "object") {
    for (const [key, val] of Object.entries(raw as Record<string, LibroDiarioEntry>)) {
      if (!val) continue
      entries.push({ ...val, id: key, tipo: val.tipo ?? "Paciente" })
    }
  }
  // Orden estable por sello de creación. Las entradas sin `createdAt` (datos viejos
  // en formato mapa, cuyo orden real ya se había perdido) quedan primero conservando
  // su orden relativo previo; las nuevas se ordenan por cuándo se agregaron.
  return entries.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
}

// "Particular" se identifica por la obra social: vacío, "-" o el texto
// "particular" (cualquier mayúscula). Así un paciente cuya obra social quedó
// cargada como "PARTICULAR" se trata como particular y no como una obra social
// real (de ahí salía el desfase cobertura "Obra Social" / obraSocial "PARTICULAR").
export function esParticular(obraSocial: string | undefined | null): boolean {
  const t = (obraSocial ?? "").trim().toLowerCase()
  return t === "" || t === "-" || t === "particular"
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
  const particular = esParticular(obraSocial)
  const entry: LibroDiarioEntry = {
    id: entryId,
    tipo: "Paciente",
    nombreApellido,
    cobertura: particular ? "Particular" : "Obra Social",
    obraSocial: particular ? "-" : obraSocial,
    debe: 0,
    haber: 0,
    createdAt: Date.now(),
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

// Prepara las rutas de un cobro de traumatología para el Libro Diario (caja),
// para fusionarlas en la MISMA escritura multi-path que guarda la consulta (todo
// o nada: no queda una consulta con cobro sin su movimiento en el libro, ni al
// revés). A diferencia de las sesiones de kine (fila en $0 que completa recepción),
// acá el traumatólogo ya sabe lo que cobró: haber directo, taggeado como
// traumatología. Sin dedup por paciente/día: cada consulta cobrada es un
// movimiento propio (un paciente puede tener kine y trauma el mismo día).
export function cobroTraumaUpdates(entry: {
  nombreApellido: string
  obraSocial: string
  monto: number
  fecha: string // yyyy-MM-dd
}): Record<string, unknown> {
  if (!entry.monto || entry.monto <= 0) return {}
  const particular = esParticular(entry.obraSocial)
  const entryId = crypto.randomUUID()
  const libroEntry: LibroDiarioEntry = {
    id: entryId,
    tipo: "Paciente",
    nombreApellido: entry.nombreApellido,
    cobertura: particular ? "Particular" : "Obra Social",
    obraSocial: particular ? "-" : entry.obraSocial,
    debe: 0,
    haber: entry.monto,
    especialidad: "traumatologia",
    createdAt: Date.now(),
  }
  return {
    [`libroDiario/${entry.fecha}/fecha`]: entry.fecha,
    [`libroDiario/${entry.fecha}/entradas/${entryId}`]: libroEntry,
  }
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

// Una "tajada" del resumen: haber/debe por día + desglose por cobertura/tipo.
// Se usa tanto para el total como para cada especialidad.
export interface LibroResumenSlice {
  porDia: Record<string, { haber: number; debe: number }>
  // Desglose de la recaudación (haber) y egresos (debe) del rango
  haberParticular: number // pacientes Particular
  haberObraSocial: number // pacientes con Obra Social
  haberIngreso: number    // entradas tipo Ingreso
  debeGasto: number       // entradas tipo Gasto
}

// El total (campos planos, retrocompat) + el mismo desglose partido por
// especialidad (kinesiología incluye las entradas legacy sin tag).
export interface LibroResumen extends LibroResumenSlice {
  porEspecialidad: Record<Especialidad, LibroResumenSlice>
}

export function emptyLibroSlice(): LibroResumenSlice {
  return { porDia: {}, haberParticular: 0, haberObraSocial: 0, haberIngreso: 0, debeGasto: 0 }
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

  const total = emptyLibroSlice()
  const kine = emptyLibroSlice()
  const trauma = emptyLibroSlice()

  // Acumula una entrada (haber/debe por día + desglose por cobertura/tipo) en una tajada.
  const acumular = (s: LibroResumenSlice, fecha: string, e: LibroDiarioEntry) => {
    const h = Number(e.haber) || 0
    const d = Number(e.debe) || 0
    const dia = s.porDia[fecha] ?? (s.porDia[fecha] = { haber: 0, debe: 0 })
    dia.haber += h
    dia.debe += d
    const tipo = e.tipo ?? "Paciente"
    if (tipo === "Ingreso") s.haberIngreso += h
    else if (tipo === "Gasto") s.debeGasto += d
    else if (!esParticular(e.obraSocial)) s.haberObraSocial += h
    else s.haberParticular += h
  }

  if (snapshot.exists()) {
    snapshot.forEach((daySnap) => {
      const fecha = daySnap.key!
      const entradas = normalizeLibroEntradas((daySnap.val() as { entradas?: unknown })?.entradas)
      for (const e of entradas) {
        // Entradas sin tag = kinesiología (retrocompat). El total suma todo.
        const slice = e.especialidad === "traumatologia" ? trauma : kine
        acumular(total, fecha, e)
        acumular(slice, fecha, e)
      }
    })
  }
  return { ...total, porEspecialidad: { kinesiologia: kine, traumatologia: trauma } }
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

// Agrega una entrada "N- dd/mm/yyyy HH:mm" al historial libre, con numeración
// correlativa — mismo formato que usa confirmarAsistencia
export function appendSesionAlHistorial(historial: string, fechaHora: string): string {
  const entry = `${getNextSessionNumber(historial)}- ${fechaHora}`
  return historial.trim() ? `${historial.trim()}\n${entry}` : entry
}

export function getNextSessionNumber(text: string): number {
  // Mismo criterio que countSesionesEnHistorial (ver SESION_RE): cuenta "N-"
  // reales, no fechas ni teléfonos anotados en el historial libre.
  const matches = [...text.matchAll(SESION_RE)]
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

  // Guard de fecha: no se puede registrar asistencia de un turno futuro (todavía no
  // pasó). Defensa a nivel datos además del gateo en la UI. Hoy en TZ Argentina.
  const hoyKey = format(new Date(), "yyyy-MM-dd", { timeZone: TZ })
  if (fecha > hoyKey) throw new Error("TURNO_FUTURO")

  // Guard de idempotencia: si otro usuario ya lo confirmó, no duplicar la sesión
  const turnoSnap = await get(ref(db, `turnos/${fecha}/${turnoId}`))
  if (!turnoSnap.exists()) throw new Error("TURNO_NO_ENCONTRADO")
  const estadoPrevio = (turnoSnap.val() as Turno).estado
  if (estadoPrevio === "asistio") return { alreadyConfirmed: true }

  // Turno de traumatología: confirmar solo marca el estado. NO registra sesión ni
  // toca tratamientos/libro de kinesiología (trauma tiene su propio modelo — Fase 3).
  if ((turnoSnap.val() as Turno).especialidad === "traumatologia") {
    const upd: Record<string, unknown> = { [`turnos/${fecha}/${turnoId}/estado`]: "asistio" }
    const rev: Record<string, unknown> = { [`turnos/${fecha}/${turnoId}/estado`]: estadoPrevio }
    await update(ref(db), upd)
    await writeLog({ accion: "confirmar_asistencia", detalle: `Confirmó asistencia (traumatología) de ${nombre} ${apellido} (${fecha} ${hora})`, entidadId: patientId })
    return { alreadyConfirmed: false, revert: rev }
  }

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

// Busca (desde el final) la sesión de FALTA de un día dentro de las sesiones de un
// tratamiento. Matchea por la fecha dd/mm/yyyy embebida en el texto (un turno es de
// un solo día). -1 si no hay.
function findFaltaIndex(sesiones: string[], dmy: string): number {
  for (let i = sesiones.length - 1; i >= 0; i--) {
    if (sesiones[i].includes("FALTA") && sesiones[i].includes(dmy)) return i
  }
  return -1
}

export interface ReconciliarAusenciaResult {
  /** entro = pasó a ausente · toggle = cambió la justificación · salio = dejó de ser ausente · sin_cambio = sin efecto */
  tipo: "entro" | "toggle" | "salio" | "sin_cambio"
  justificado: boolean
  /** true si se tocó el tratamiento más reciente (false si el paciente no tiene tratamientos) */
  afectoTratamiento: boolean
  /** Sesiones restantes del tratamiento más reciente tras el cambio, o null si no hay tratamientos */
  remaining: number | null
  /** Payload multi-path para deshacer todo el cambio (turno + tratamiento) */
  revert: Record<string, unknown>
}

// Reconcilia el tratamiento más reciente con el estado de ausencia del turno, en UNA
// escritura atómica (turno + tratamiento). Reglas (decisión del usuario):
//  - Marcar AUSENTE registra la falta como sesión usada en el tratamiento más reciente
//    (consume una sesión). NO toca el historial libre ni el libro diario (una falta no se cobra).
//  - Si la falta es JUSTIFICADA, además suma 1 a las sesiones autorizadas → no pierde la sesión.
//  - Quitar la marca de ausente (o cambiar la justificación) revierte el efecto correspondiente.
// Idempotente: relee el turno fresco, así re-guardar no vuelve a descontar. Devuelve `revert`
// para el "Deshacer" del toast. Si el paciente no tiene tratamientos, solo cambia el estado del turno.
export async function reconciliarAusencia(params: {
  patientId: string
  turnoId: string
  fecha: string // yyyy-MM-dd
  hora: string
  nombre: string
  apellido: string
  notas: string | null
  estadoNuevo: TurnoEstado
  justificadoNuevo: boolean
}): Promise<ReconciliarAusenciaResult> {
  const { patientId, turnoId, fecha, hora, nombre, apellido, notas, estadoNuevo, justificadoNuevo } = params

  // Idempotencia: el estado real manda (no el prop del modal, que puede estar viejo)
  const turnoSnap = await get(ref(db, `turnos/${fecha}/${turnoId}`))
  if (!turnoSnap.exists()) throw new Error("TURNO_NO_ENCONTRADO")
  const turnoPrev = turnoSnap.val() as Turno
  const estadoPrevio = turnoPrev.estado
  const justPrev = turnoPrev.justificado === true

  const eraAusente = estadoPrevio === "ausente"
  const esAusente = estadoNuevo === "ausente"

  // Campos del turno (siempre se persisten); revert con los valores previos
  const updates: Record<string, unknown> = {
    [`turnos/${fecha}/${turnoId}/hora`]: hora,
    [`turnos/${fecha}/${turnoId}/estado`]: estadoNuevo,
    [`turnos/${fecha}/${turnoId}/notas`]: notas,
    [`turnos/${fecha}/${turnoId}/justificado`]: esAusente ? justificadoNuevo : null,
  }
  const revert: Record<string, unknown> = {
    [`turnos/${fecha}/${turnoId}/hora`]: turnoPrev.hora,
    [`turnos/${fecha}/${turnoId}/estado`]: estadoPrevio,
    [`turnos/${fecha}/${turnoId}/notas`]: turnoPrev.notas ?? null,
    [`turnos/${fecha}/${turnoId}/justificado`]: turnoPrev.justificado ?? null,
  }

  // Falta registrada ⇔ ausente; sesión autorizada extra ⇔ ausente && justificada
  const faltaAhora = esAusente
  const autAntes = eraAusente && justPrev ? 1 : 0
  const autAhora = esAusente && justificadoNuevo ? 1 : 0
  const cambiaFalta = eraAusente !== esAusente
  const cambiaLabel = eraAusente && esAusente && justPrev !== justificadoNuevo
  const cambiaAut = autAntes !== autAhora

  let remaining: number | null = null
  let afectoTratamiento = false

  // Turno de traumatología: solo se actualizan los campos del turno. La falta NO
  // toca los tratamientos/sesiones de kinesiología (mismo guard que confirmarAsistencia).
  const esTurnoTrauma = turnoPrev.especialidad === "traumatologia"

  if (!esTurnoTrauma && (cambiaFalta || cambiaLabel || cambiaAut)) {
    const pacSnap = await get(ref(db, `pacientes/${patientId}`))
    if (!pacSnap.exists()) throw new Error("PACIENTE_NO_ENCONTRADO")
    const raw = pacSnap.val() as Record<string, unknown>
    const tratamientos = parseTratamientosRaw(raw.tratamientos)

    if (tratamientos.length > 0) {
      afectoTratamiento = true
      const idx = tratamientos.length - 1
      const latest = tratamientos[idx]
      const [year, month, day] = fecha.split("-")
      const dmy = `${day}/${month}/${year}`
      const faltaTag = (just: boolean) => `FALTA (${just ? "justificada" : "no justificada"})`
      const sesiones = [...latest.sesiones]

      if (cambiaFalta && faltaAhora) {
        // Entró a ausente → registrar la falta como sesión usada
        sesiones.push(`Sesión ${sesiones.length + 1} — ${faltaTag(justificadoNuevo)} ${dmy} ${hora}`)
      } else if (cambiaFalta && !faltaAhora) {
        // Dejó de ser ausente → quitar la falta de ese día
        const i = findFaltaIndex(sesiones, dmy)
        if (i >= 0) sesiones.splice(i, 1)
      } else if (cambiaLabel) {
        // Cambió la justificación estando ausente → re-etiquetar la falta
        const i = findFaltaIndex(sesiones, dmy)
        if (i >= 0) sesiones[i] = sesiones[i].replace(/FALTA \([^)]*\)/, faltaTag(justificadoNuevo))
      }

      const nuevasAut = Math.max(0, latest.sesionesAutorizadas + (autAhora - autAntes))
      updates[`pacientes/${patientId}/tratamientos`] = tratamientos.map((t, i) =>
        i === idx ? { ...t, sesiones, sesionesAutorizadas: nuevasAut } : t
      )
      updates[`pacientes/${patientId}/ultima_actualizacion`] = {
        fecha: new Date().toISOString(),
        usuario: auth.currentUser?.displayName || auth.currentUser?.email || "Calendario",
      }
      revert[`pacientes/${patientId}/tratamientos`] = raw.tratamientos ?? null
      revert[`pacientes/${patientId}/ultima_actualizacion`] = raw.ultima_actualizacion ?? null

      remaining = nuevasAut - sesiones.length
    }
  }

  await update(ref(db), updates)

  let tipo: ReconciliarAusenciaResult["tipo"] = "sin_cambio"
  if (cambiaFalta && faltaAhora) tipo = "entro"
  else if (cambiaFalta && !faltaAhora) tipo = "salio"
  else if (cambiaLabel) tipo = "toggle"

  const cambios: LogCambio = {}
  if (turnoPrev.hora !== hora) cambios["Hora"] = { antes: turnoPrev.hora, despues: hora }
  if (estadoPrevio !== estadoNuevo) cambios["Estado"] = { antes: estadoPrevio, despues: estadoNuevo }
  if ((turnoPrev.notas ?? "") !== (notas ?? "")) cambios["Notas"] = { antes: turnoPrev.notas ?? "", despues: notas ?? "" }

  let accion: LogAccion = "editar_turno"
  let detalle = `Editó turno de ${nombre} ${apellido} (${fecha} ${hora})`
  if (tipo === "entro") {
    accion = "marcar_ausente"
    detalle = !afectoTratamiento
      ? `Marcó ausente a ${nombre} ${apellido} (sin tratamiento cargado) (${fecha} ${turnoPrev.hora})`
      : justificadoNuevo
      ? `Marcó ausente (justificada, +1 sesión autorizada) a ${nombre} ${apellido} (${fecha} ${turnoPrev.hora})`
      : `Marcó ausente (no justificada, descontó 1 sesión) a ${nombre} ${apellido} (${fecha} ${turnoPrev.hora})`
  } else if (tipo === "toggle") {
    accion = "marcar_ausente"
    detalle = justificadoNuevo
      ? `Marcó la falta de ${nombre} ${apellido} como justificada (+1 sesión autorizada) (${fecha})`
      : `Marcó la falta de ${nombre} ${apellido} como no justificada (quitó la sesión autorizada extra) (${fecha})`
  } else if (tipo === "salio") {
    detalle = `Quitó la marca de ausente de ${nombre} ${apellido} (${fecha})${afectoTratamiento ? "; se liberó la sesión" : ""}`
  }
  await writeLog({ accion, detalle, entidadId: patientId, cambios })

  return { tipo, justificado: justificadoNuevo, afectoTratamiento, remaining, revert }
}

export async function deshacerAusente(
  revert: Record<string, unknown>,
  info: { patientId: string; nombre: string; apellido: string; fecha: string; hora: string }
): Promise<void> {
  await update(ref(db), revert)
  await writeLog({
    accion: "deshacer_ausente",
    detalle: `Deshizo el cambio de ausencia de ${info.nombre} ${info.apellido} (${info.fecha} ${info.hora})`,
    entidadId: info.patientId,
  })
}

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