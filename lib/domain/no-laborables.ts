// Dominio puro — días no laborables (consultorio cerrado → no se agendan turnos).
// Dos fuentes: cierres anuales fijos (en código, se repiten todos los años) y
// días marcados a mano en `config/diasNoLaborables/{yyyy-MM-dd}`.
//
// Los cierres fijos están duplicados en database.rules.json (validación de
// turnos nuevos): si se cambia esta lista, actualizar también las reglas.

export const CIERRES_ANUALES: Record<string, string> = {
  "12-24": "Nochebuena",
  "12-25": "Navidad",
  "12-31": "Fin de año",
  "01-01": "Año Nuevo",
}

export type DiaNoLaborableManual = {
  motivo: string
  por?: string
  creadoEn?: number
}

export type NoLaborable = {
  motivo: string
  tipo: "anual" | "manual"
  por?: string
}

/** Motivo de cierre del día (yyyy-MM-dd), o null si es laborable. Lo manual gana sobre lo anual. */
export function noLaborableDe(
  fecha: string,
  manuales: Record<string, DiaNoLaborableManual>,
): NoLaborable | null {
  const m = manuales[fecha]
  if (m) return { motivo: m.motivo, tipo: "manual", por: m.por }
  const anual = CIERRES_ANUALES[fecha.slice(5)]
  return anual ? { motivo: anual, tipo: "anual" } : null
}

/** Fechas yyyy-MM-dd entre desde y hasta (inclusive). Vacío si hasta < desde. */
export function fechasEntre(desde: string, hasta: string): string[] {
  const [y1, m1, d1] = desde.split("-").map(Number)
  const [y2, m2, d2] = hasta.split("-").map(Number)
  const cur = new Date(Date.UTC(y1, m1 - 1, d1))
  const end = Date.UTC(y2, m2 - 1, d2)
  const out: string[] = []
  while (cur.getTime() <= end && out.length < 366) {
    out.push(cur.toISOString().slice(0, 10))
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return out
}
