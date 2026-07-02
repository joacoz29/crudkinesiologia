import { Patient, Turno } from "@/types"
import { getSessionStats, parseTratamientosRaw, horaToMin } from "@/lib/helpers"
import { edadActual } from "@/lib/edad"

// ───────────────────────────────────────────────────────────────────────────
// Pestaña "Pendientes" (v1) — tareas DERIVADAS de datos ya cacheados.
//
// Filosofía (ver skill kine-dev): es una vista de SOLO LECTURA que se computa en
// memoria sobre lo que ya tenemos (usePatients live + una lectura por rango de
// turnos). No escribe nada → no hay nada que auditar, y cada tarea desaparece
// sola cuando alguien completa el dato (auto-resolvente). Cero lecturas nuevas
// salvo el rango de turnos.
//
// Para sumar tipos de tarea: agregá un campo a CAMPOS_BASICOS o un bloque nuevo
// en computeTareasPacientes/computeTareasTurnos. Las funciones son puras y
// testeables (sin acceso a la red ni a estado externo).
// ───────────────────────────────────────────────────────────────────────────

export type TareaSeveridad = "alta" | "media" | "baja"
export type TareaCategoria = "datos" | "clinico" | "operativo"

export interface Tarea {
  /** Id estable (tipo + entidad) para keys de React y dedup */
  id: string
  categoria: TareaCategoria
  severidad: TareaSeveridad
  titulo: string
  descripcion: string
  /** Para el CTA "Abrir ficha" (cuando la tarea es de un paciente) */
  patientId?: string
  /** Para el CTA "Marcar asistencia": abre el modal de edición de ese turno */
  turnoRef?: { fecha: string; turnoId: string }
}

// Campos de la ficha que consideramos "básicos". Editable acá para sumar/quitar
// sin tocar la lógica. OJO: en obraSocial el valor "-" significa Particular (es
// válido) y NO se marca como faltante — esVacio solo detecta string vacío.
const CAMPOS_BASICOS: {
  key: keyof Patient
  label: string
  severidad: TareaSeveridad
  /** El dni puede venir como número legacy: se chequea por dígitos, no por string */
  digits?: boolean
  /** Chequeo custom de "faltante" (edad falta si no hay ni fecha de nacimiento ni edad legacy) */
  check?: (p: Patient) => boolean
}[] = [
  { key: "telefono", label: "teléfono", severidad: "media" },
  { key: "dni", label: "DNI", severidad: "media", digits: true },
  { key: "obraSocial", label: "obra social", severidad: "baja" },
  { key: "diagnostico", label: "diagnóstico", severidad: "media" },
  { key: "edad", label: "edad", severidad: "baja", check: (p) => edadActual(p) === null },
]

const esVacio = (v: unknown): boolean => String(v ?? "").trim() === ""
export const soloDigitos = (v: unknown): string => String(v ?? "").replace(/\D/g, "")
const nombreCompleto = (p: Pick<Patient, "nombre" | "apellido">): string =>
  `${p.nombre ?? ""} ${p.apellido ?? ""}`.trim()

// Un DNI "válido" tiene 6-9 dígitos, no son todos iguales (00000000, 11111111…)
// y no es un valor de relleno conocido. Los DNIs compartidos pero INVÁLIDOS son
// relleno (cargar el real), no duplicados reales. (Sincronizar con scripts/dni-audit.mjs)
const DNI_RELLENO = new Set(["12345678", "1234567", "87654321", "123456789"])
export const dniEsValido = (d: string): boolean =>
  d.length >= 6 && d.length <= 9 && !/^(\d)\1+$/.test(d) && !DNI_RELLENO.has(d)

const SEV_ORDEN: Record<TareaSeveridad, number> = { alta: 0, media: 1, baja: 2 }

/** "Tipo" de tarea = prefijo del id (antes del primer ':'). Para CTAs/dedup. */
export const tareaKind = (t: Tarea): string => t.id.split(":")[0]

/** Ordena por severidad (alta → baja); estable para el resto. */
export function ordenarTareas(tareas: Tarea[]): Tarea[] {
  return [...tareas].sort((a, b) => SEV_ORDEN[a.severidad] - SEV_ORDEN[b.severidad])
}

/** Tareas derivadas SOLO de la ficha del paciente (cero lecturas extra). */
export function computeTareasPacientes(patients: Patient[]): Tarea[] {
  const tareas: Tarea[] = []

  for (const p of patients) {
    const nombre = nombreCompleto(p)

    // 1) Datos básicos faltantes
    for (const campo of CAMPOS_BASICOS) {
      const faltante = campo.check
        ? campo.check(p)
        : campo.digits
        ? soloDigitos(p[campo.key]) === ""
        : esVacio(p[campo.key])
      if (faltante) {
        tareas.push({
          id: `falta_${String(campo.key)}:${p.id}`,
          categoria: "datos",
          severidad: campo.severidad,
          titulo: `Falta ${campo.label}`,
          descripcion: `${nombre} no tiene ${campo.label} cargado.`,
          patientId: p.id,
        })
      }
    }

    // 2) Tratamiento con sesiones autorizadas pero sin N° de autorización
    const trats = parseTratamientosRaw(p.tratamientos)
    if (trats.some((t) => t.sesionesAutorizadas > 0 && esVacio(t.nroAutorizacion))) {
      tareas.push({
        id: `sin_nro_autorizacion:${p.id}`,
        categoria: "datos",
        severidad: "media",
        titulo: "Tratamiento sin N° de autorización",
        descripcion: `${nombre} tiene sesiones autorizadas sin número de autorización cargado.`,
        patientId: p.id,
      })
    }

    // 3) Sesiones por agotar / agotadas
    const stats = getSessionStats(p)
    if (stats) {
      const restantes = stats.authorized - stats.used
      if (restantes <= 2) {
        tareas.push({
          id: `sesiones_por_agotar:${p.id}`,
          categoria: "clinico",
          severidad: restantes <= 0 ? "alta" : "media",
          titulo: restantes <= 0 ? "Sesiones agotadas" : "Sesiones por agotar",
          descripcion:
            restantes <= 0
              ? `${nombre} agotó sus sesiones (${stats.used}/${stats.authorized}). Hay que reautorizar.`
              : `A ${nombre} le ${restantes === 1 ? "queda" : "quedan"} ${restantes} sesión${
                  restantes === 1 ? "" : "es"
                } (${stats.used}/${stats.authorized}).`,
          patientId: p.id,
        })
      }
    }
  }

  // 4) DNIs compartidos por 2+ pacientes. Se distingue:
  //    - DNI inválido/relleno (ej. "0", "00000000"): NO es duplicado real → cargar
  //      el DNI verdadero. Severidad baja (es higiene de datos, no urgente).
  //    - DNI válido compartido: duplicado real (rompe la opinión por DNI y la
  //      identificación) → revisar/mergear. Severidad alta.
  const porDni = new Map<string, Patient[]>()
  for (const p of patients) {
    const dni = soloDigitos(p.dni)
    if (!dni) continue // los vacíos ya se marcan como "Falta DNI" más arriba
    const arr = porDni.get(dni)
    if (arr) arr.push(p)
    else porDni.set(dni, [p])
  }
  for (const [dni, grupo] of porDni) {
    if (grupo.length <= 1) continue // un solo paciente con ese DNI: no es duplicado
    if (!dniEsValido(dni)) {
      tareas.push({
        id: `dni_invalido:${dni}`,
        categoria: "datos",
        severidad: "baja",
        titulo: "DNI de relleno",
        descripcion: `El DNI "${dni}" (de relleno) está en ${grupo.length} pacientes — cargar el real. Ej.: ${grupo
          .slice(0, 5)
          .map(nombreCompleto)
          .join(", ")}${grupo.length > 5 ? "…" : ""}`,
        patientId: grupo[0].id,
      })
    } else {
      tareas.push({
        id: `dni_duplicado:${dni}`,
        categoria: "datos",
        severidad: "alta",
        titulo: "DNI duplicado",
        descripcion: `El DNI ${dni} aparece en ${grupo.length} pacientes: ${grupo
          .map(nombreCompleto)
          .join(", ")}.`,
        patientId: grupo[0].id,
      })
    }
  }

  return tareas
}

/**
 * Tareas que dependen de los turnos. `turnosPorFecha` viene de una sola lectura
 * por rango (fetchTurnosPorRango). `hoyKey` en formato yyyy-MM-dd y `nowMin` en
 * minutos del día (ambos en hora AR; los calcula la vista).
 *
 * Nota: "sin próximo turno" depende de que el rango cubra el futuro razonable
 * (la vista baja +120 días). Un paciente con turno más allá de esa ventana se
 * marcaría por error — improbable en la práctica del consultorio.
 */
export function computeTareasTurnos(
  patients: Patient[],
  turnosPorFecha: Record<string, Turno[]>,
  hoyKey: string,
  nowMin: number,
): Tarea[] {
  const tareas: Tarea[] = []

  // Próximo turno futuro (>= hoy, no cancelado) por paciente — por id y por nombre,
  // para tolerar turnos legacy sin patientId (mismo fallback que la pestaña Datos).
  // Guardamos la fecha más temprana para poder mostrarla en la tarea.
  const proximoPorId = new Map<string, string>()
  const proximoPorNombre = new Map<string, string>()
  for (const [fecha, turnos] of Object.entries(turnosPorFecha)) {
    if (fecha < hoyKey) continue
    for (const t of turnos) {
      if (t.estado === "cancelado") continue
      if (t.patientId) {
        const cur = proximoPorId.get(t.patientId)
        if (!cur || fecha < cur) proximoPorId.set(t.patientId, fecha)
      }
      const nk = nombreCompleto(t).toLowerCase()
      const curN = proximoPorNombre.get(nk)
      if (!curN || fecha < curN) proximoPorNombre.set(nk, fecha)
    }
  }
  const proximoDe = (p: Patient): string | undefined =>
    proximoPorId.get(p.id) ?? proximoPorNombre.get(nombreCompleto(p).toLowerCase())

  // 5) Turnos pasados que quedaron en "pendiente" (no se marcó asistió/ausente)
  for (const [fecha, turnos] of Object.entries(turnosPorFecha)) {
    if (fecha >= hoyKey) continue
    const [y, m, d] = fecha.split("-")
    for (const t of turnos) {
      if (t.estado !== "pendiente") continue
      tareas.push({
        id: `turno_pendiente:${fecha}:${t.id}`,
        categoria: "operativo",
        severidad: "media",
        titulo: "Turno sin marcar",
        descripcion: `El turno de ${nombreCompleto(t)} del ${d}/${m}/${y} ${t.hora} quedó pendiente (¿asistió o faltó?).`,
        patientId: t.patientId,
        turnoRef: { fecha, turnoId: t.id },
      })
    }
  }

  // 6) Turnos de HOY cuya hora ya pasó y siguen pendientes (recordatorio de marcar)
  for (const t of turnosPorFecha[hoyKey] ?? []) {
    if (t.estado !== "pendiente") continue
    if (horaToMin(t.hora) >= nowMin) continue // todavía no pasó la hora
    tareas.push({
      id: `turno_hoy:${hoyKey}:${t.id}`,
      categoria: "operativo",
      severidad: "media",
      titulo: "Turno de hoy sin marcar",
      descripcion: `El turno de ${nombreCompleto(t)} de las ${t.hora} ya pasó y sigue sin marcar.`,
      patientId: t.patientId,
      turnoRef: { fecha: hoyKey, turnoId: t.id },
    })
  }

  // 7) Sesiones: sin próximo turno (quedan sesiones) o reautorizar (agotó + tiene turno)
  for (const p of patients) {
    const stats = getSessionStats(p)
    if (!stats) continue
    const restantes = stats.authorized - stats.used
    const prox = proximoDe(p)
    if (restantes > 0) {
      if (!prox) {
        tareas.push({
          id: `sin_proximo_turno:${p.id}`,
          categoria: "operativo",
          severidad: "media",
          titulo: "Sin próximo turno",
          descripcion: `${nombreCompleto(p)} tiene ${restantes} sesión${
            restantes === 1 ? "" : "es"
          } por usar y no tiene turno agendado.`,
          patientId: p.id,
        })
      }
    } else if (prox) {
      // Agotó (o excedió) las sesiones autorizadas y TIENE un turno próximo →
      // urgente: hay que reautorizar antes de que venga. (Si no tuviera turno
      // próximo, queda la tarea clínica "Sesiones agotadas" de computeTareasPacientes.)
      const [, mm, dd] = prox.split("-")
      tareas.push({
        id: `reautorizar:${p.id}`,
        categoria: "clinico",
        severidad: "alta",
        titulo: "Reautorizar antes del turno",
        descripcion: `${nombreCompleto(p)} agotó sus sesiones (${stats.used}/${stats.authorized}) y tiene turno el ${dd}/${mm} — gestionar la nueva orden.`,
        patientId: p.id,
      })
    }
  }

  return tareas
}
