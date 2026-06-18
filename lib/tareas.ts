import { Patient, Turno } from "@/types"
import { getSessionStats, parseTratamientosRaw } from "@/lib/helpers"

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
}[] = [
  { key: "telefono", label: "teléfono", severidad: "media" },
  { key: "dni", label: "DNI", severidad: "media", digits: true },
  { key: "obraSocial", label: "obra social", severidad: "baja" },
  { key: "diagnostico", label: "diagnóstico", severidad: "media" },
  { key: "edad", label: "edad", severidad: "baja" },
]

const esVacio = (v: unknown): boolean => String(v ?? "").trim() === ""
const soloDigitos = (v: unknown): string => String(v ?? "").replace(/\D/g, "")
const nombreCompleto = (p: Pick<Patient, "nombre" | "apellido">): string =>
  `${p.nombre ?? ""} ${p.apellido ?? ""}`.trim()

const SEV_ORDEN: Record<TareaSeveridad, number> = { alta: 0, media: 1, baja: 2 }

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
      const faltante = campo.digits
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

  // 4) DNI duplicado entre pacientes distintos (rompe la opinión por DNI y confunde)
  const porDni = new Map<string, Patient[]>()
  for (const p of patients) {
    const dni = soloDigitos(p.dni)
    if (!dni) continue
    const arr = porDni.get(dni)
    if (arr) arr.push(p)
    else porDni.set(dni, [p])
  }
  for (const [dni, grupo] of porDni) {
    if (grupo.length > 1) {
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
 * por rango (fetchTurnosPorRango). `hoyKey` en formato yyyy-MM-dd (hora AR).
 *
 * Nota: "sin próximo turno" depende de que el rango cubra el futuro razonable
 * (la vista baja +120 días). Un paciente con turno más allá de esa ventana se
 * marcaría por error — improbable en la práctica del consultorio.
 */
export function computeTareasTurnos(
  patients: Patient[],
  turnosPorFecha: Record<string, Turno[]>,
  hoyKey: string,
): Tarea[] {
  const tareas: Tarea[] = []

  // Pacientes con algún turno futuro no cancelado (por id y por nombre, para
  // tolerar turnos legacy sin patientId — mismo fallback que usa la pestaña Datos)
  const conFuturoId = new Set<string>()
  const conFuturoNombre = new Set<string>()
  for (const [fecha, turnos] of Object.entries(turnosPorFecha)) {
    if (fecha < hoyKey) continue
    for (const t of turnos) {
      if (t.estado === "cancelado") continue
      if (t.patientId) conFuturoId.add(t.patientId)
      conFuturoNombre.add(nombreCompleto(t).toLowerCase())
    }
  }

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

  // 6) Pacientes con sesiones por usar pero sin próximo turno agendado
  for (const p of patients) {
    const stats = getSessionStats(p)
    if (!stats) continue
    const restantes = stats.authorized - stats.used
    if (restantes <= 0) continue
    const tieneFuturo =
      conFuturoId.has(p.id) || conFuturoNombre.has(nombreCompleto(p).toLowerCase())
    if (!tieneFuturo) {
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
  }

  return tareas
}
