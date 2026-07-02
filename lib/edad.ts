import { differenceInYears, parseISO, isValid } from "date-fns"
import { Patient } from "@/types"

// Edad de un paciente. La fuente preferida es `fechaNacimiento` (exacta y se
// actualiza sola cada año); si no está, cae a la `edad` guardada (snapshot legacy
// que quedó de cuando se pedía la edad como número). No se puede derivar la fecha
// desde una edad, por eso los pacientes viejos conservan su `edad` tal cual.

/** Edad (años cumplidos) a partir de "yyyy-MM-dd", o null si falta/invalida/futura. */
export function edadDesdeFecha(fecha: string | undefined | null): number | null {
  if (!fecha) return null
  const d = parseISO(fecha)
  if (!isValid(d)) return null
  const anios = differenceInYears(new Date(), d)
  return anios >= 0 && anios < 150 ? anios : null
}

/**
 * Edad a mostrar/usar: desde `fechaNacimiento` si existe, si no desde la `edad`
 * legacy. null si no hay ninguna de las dos.
 */
export function edadActual(p: Pick<Patient, "fechaNacimiento" | "edad">): number | null {
  const desde = edadDesdeFecha(p.fechaNacimiento)
  if (desde !== null) return desde
  const n = parseInt(String(p.edad ?? ""), 10)
  return Number.isNaN(n) || n <= 0 ? null : n
}
