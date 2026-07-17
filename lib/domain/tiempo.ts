// Dominio puro — tiempo. Sin dependencias de Firebase ni de React.
// Movido verbatim desde lib/helpers.ts (R1 del plan de refactor; ver
// docs/architecture.md → Observaciones #5/#6).

// Timezone del consultorio: las claves {yyyy-MM-dd} / {yyyy-MM} SIEMPRE se
// calculan en hora argentina, no UTC (toISOString cae en "mañana" después de
// las 21:00) ni la del dispositivo.
export const TZ = "America/Argentina/Buenos_Aires"

// Hora "HH:MM" → minutos del día, y viceversa (para ventanas horarias)
export function horaToMin(h: string): number {
  const [hh, mm] = (h ?? "").split(":")
  return (parseInt(hh, 10) || 0) * 60 + (parseInt(mm, 10) || 0)
}
export function minToHora(m: number): string {
  const c = Math.max(0, Math.min(24 * 60 - 1, m))
  return `${String(Math.floor(c / 60)).padStart(2, "0")}:${String(c % 60).padStart(2, "0")}`
}
