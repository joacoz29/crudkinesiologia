// Flujo clínico — asistencia y ausencias de turnos. Movido verbatim desde
// lib/helpers.ts (R2; ver docs/architecture.md → obs #6). Es la lógica de
// dominio con escrituras: guards de idempotencia/fecha, updates multi-path
// atómicos con payload `revert` para el "Deshacer", y el comportamiento por
// especialidad vía el registry (lib/especialidades).

import { ref, get, update } from "firebase/database"
import { format } from "date-fns-tz"
import { db, auth } from "@/lib/firebase"
import { Turno, TurnoEstado } from "@/types"
import { ESPECIALIDADES, espDe } from "@/lib/especialidades"
import { TZ } from "@/lib/domain/tiempo"
import { parseTratamientosRaw, getNextSessionNumber } from "@/lib/domain/paciente"
import { buildLibroDiarioEntry } from "@/lib/data/libro"
import { writeLog, LogAccion, LogCambio } from "@/lib/audit/log"

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

  // Especialidad sin modelo de sesiones de kine (p. ej. traumatología): confirmar
  // solo marca el estado. NO registra sesión ni toca tratamientos/libro de kine
  // (su facturación va por consulta; ver lib/especialidades.ts).
  const espTurno = espDe(turnoSnap.val() as Turno)
  if (!ESPECIALIDADES[espTurno].registraSesionKine) {
    const upd: Record<string, unknown> = { [`turnos/${fecha}/${turnoId}/estado`]: "asistio" }
    const rev: Record<string, unknown> = { [`turnos/${fecha}/${turnoId}/estado`]: estadoPrevio }
    await update(ref(db), upd)
    await writeLog({ accion: "confirmar_asistencia", detalle: `Confirmó asistencia (${ESPECIALIDADES[espTurno].label.toLowerCase()}) de ${nombre} ${apellido} (${fecha} ${hora})`, entidadId: patientId })
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

  // Especialidad sin modelo de sesiones de kine: solo se actualizan los campos
  // del turno. La falta NO toca los tratamientos/sesiones de kinesiología
  // (mismo guard que confirmarAsistencia; ver lib/especialidades.ts).
  const conSesionesKine = ESPECIALIDADES[espDe(turnoPrev)].registraSesionKine

  if (conSesionesKine && (cambiaFalta || cambiaLabel || cambiaAut)) {
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
