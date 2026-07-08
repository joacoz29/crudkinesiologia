import { Especialidad } from "@/types"

// ─────────────────────────────────────────────────────────────────────────────
// Registro central de especialidades: ÚNICA fuente de verdad de qué existe y
// cómo se comporta cada una. Todo lo que dependa de la especialidad (selector
// del header, filtros de agenda/Datos/Pendientes, split del libro, badge del
// libro, guards clínicos, routing de ficha) se deriva de acá — nada de
// `=== "traumatologia"` suelto por el código.
//
// ── Cómo sumar una especialidad (próxima: Medicina Clínica — Dr. Jorge Pandis) ──
// 1) types/index.ts: agregar el valor al union `Especialidad` (p. ej.
//    "medicina_clinica"). tsc va a marcar en rojo todos los
//    Record<Especialidad, ...> pendientes — ese es el checklist del compilador.
// 2) Acá: agregar la entrada con label/flags/badge. Decidir:
//    - ¿usa el modelo de sesiones de kine (confirmar asistencia registra sesión
//      en tratamientos + fila en $0 en el libro)? → registraSesionKine
//    - ¿cobra por consulta con monto desde su ficha (modelo trauma)? → cobroDirecto
//    - ¿qué ficha abre la grilla? → ficha
// 3) lib/auth-helper.ts: rol nuevo en UserRole (p. ej. "clinico"), el email del
//    médico en ROLE_MAP y userNameMap, y su especialidad en ROL_ESPECIALIDAD.
// 4) Ficha: si usa el modelo de trauma (consultas + cobro), generalizar
//    TraumaFichaModal y cobroTraumaUpdates (hoy escriben pacientes/{id}/traumatologia
//    y el tag "traumatologia" fijo) para parametrizarlos por especialidad.
//    También components/edit-patient-modal.tsx: su sección read-only lee el nodo
//    `traumatologia` fijo (label/color indigo) — parametrizarla o duplicarla.
// 5) components/admin-panel.tsx: label/color de la acción de log si se agrega una.
// 6) Reglas RTDB: pacientes/** ya hereda el permiso del padre; publicar a mano
//    solo si se crea un nodo raíz nuevo (el archivo no se despliega solo).
// ─────────────────────────────────────────────────────────────────────────────

export interface EspecialidadConfig {
  label: string
  // Al confirmar asistencia: ¿registra sesión en los tratamientos de kine y crea
  // la fila en $0 del libro (modelo kine)? Si es false, confirmar solo marca el
  // estado del turno (modelo trauma: la facturación va por consulta).
  registraSesionKine: boolean
  // ¿Cobra por consulta con un monto desde su ficha, que impacta directo en el
  // libro (modelo trauma)? OJO: hoy es documental — ningún código lo consulta
  // todavía (los switches reales son registraSesionKine y ficha). Se vuelve
  // operativo cuando se generalice la ficha de trauma (paso 4 del checklist).
  cobroDirecto: boolean
  // Qué ficha abre la grilla de pacientes en el contexto de esta especialidad.
  ficha: "kine" | "trauma"
  // Abreviatura para marcar sus movimientos en el Libro Diario (sin badge = no
  // se marca; kine es el default y no lo necesita).
  badge?: string
}

export const ESPECIALIDADES: Record<Especialidad, EspecialidadConfig> = {
  kinesiologia: {
    label: "Kinesiología",
    registraSesionKine: true,
    cobroDirecto: false,
    ficha: "kine",
  },
  traumatologia: {
    label: "Traumatología",
    registraSesionKine: false,
    cobroDirecto: true,
    ficha: "trauma",
    badge: "Trau",
  },
}

export const ESPECIALIDADES_LIST = Object.keys(ESPECIALIDADES) as Especialidad[]

// Default de retrocompatibilidad: turnos/entradas históricos sin tag son de
// kinesiología (la app era mono-especialidad).
export const ESP_DEFAULT: Especialidad = "kinesiologia"

// Especialidad efectiva de un turno/entrada (aplica el default legacy).
export function espDe(x: { especialidad?: Especialidad }): Especialidad {
  return x.especialidad ?? ESP_DEFAULT
}

// ¿El turno/entrada pertenece a esta especialidad? Generalizado para N
// especialidades (no asume que "lo que no es trauma es kine").
export function esDeEspecialidad(t: { especialidad?: Especialidad }, esp: Especialidad): boolean {
  return espDe(t) === esp
}

// Filtra un Record<fecha, T[]> por especialidad (en memoria — nunca por fetch:
// la lectura de RTDB es UNA y compartida; ver pilar de costo de datos).
// Las fechas que quedan vacías se omiten; los consumidores usan `?? []`.
export function filtrarTurnosPorEspecialidad<T extends { especialidad?: Especialidad }>(
  porFecha: Record<string, T[]>,
  esp: Especialidad,
): Record<string, T[]> {
  const out: Record<string, T[]> = {}
  for (const [fecha, ts] of Object.entries(porFecha)) {
    const filt = ts.filter((t) => esDeEspecialidad(t, esp))
    if (filt.length) out[fecha] = filt
  }
  return out
}
