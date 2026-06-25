import { Patient } from "@/types"

// Agrupa médicos derivantes tipeados con variantes (orden nombre/apellido,
// mayúsculas, acentos, títulos "Dr/Dra") bajo una sola entrada.
//
// Es SOLO PARA AGRUPAR EN LA VISTA (ranking de Derivantes en la pestaña Datos):
// NO toca el dato guardado — las fichas conservan su texto original. Función pura
// y testeable (sin red ni estado), computada sobre los pacientes ya cacheados.

// Marcas diacríticas combinantes (U+0300–U+036F): se sacan tras normalize("NFD")
// para que el acento no diferencie ("Gúrpide" ≡ "Gurpide"). Se construye desde un
// string ASCII para no embeber caracteres combinantes en el fuente.
const DIACRITICOS = new RegExp("[\\u0300-\\u036f]", "g")

// Títulos/prefijos que no aportan a la identidad del médico y se descartan al
// armar la clave (así "Dr. Gurpide" y "Gurpide" caen en el mismo grupo).
const TITULOS = new Set([
  "dr", "dra", "doc", "doctor", "doctora", "lic", "klgo", "klga",
  "kinesiologo", "kinesiologa", "prof",
])

/**
 * Clave canónica de un médico: sin acentos ni títulos, en minúsculas y con los
 * tokens ordenados alfabéticamente — así el orden de nombre/apellido no importa.
 * "Gustavo Gurpide", "Gurpide Gustavo" y "GUSTAVO GURPIDE" → "gurpide gustavo".
 */
export function normalizeDoctorKey(raw: string): string {
  const tokens = raw
    .normalize("NFD")
    .replace(DIACRITICOS, "")
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !TITULOS.has(t))
  return [...tokens].sort().join(" ")
}

export interface Derivante {
  /** Etiqueta a mostrar: la variante ORIGINAL más usada del grupo. */
  nombre: string
  /** Total de pacientes del grupo (sumando todas las variantes). */
  count: number
}

/**
 * Cuenta pacientes por médico derivante fusionando las variantes del mismo
 * nombre. La etiqueta de cada grupo es la variante original más frecuente
 * (desempate: la primera vista). Ordena por cantidad desc.
 */
export function rankDerivantes(doctores: string[]): Derivante[] {
  // clave canónica → { total, variantes: textoOriginal → veces }
  const grupos = new Map<string, { total: number; variantes: Map<string, number> }>()
  for (const raw of doctores) {
    const doc = (raw ?? "").trim()
    if (!doc) continue
    const key = normalizeDoctorKey(doc)
    if (!key) continue
    const g = grupos.get(key) ?? { total: 0, variantes: new Map<string, number>() }
    g.total++
    g.variantes.set(doc, (g.variantes.get(doc) ?? 0) + 1)
    grupos.set(key, g)
  }
  return Array.from(grupos.values())
    .map((g) => ({
      nombre: Array.from(g.variantes.entries()).sort((a, b) => b[1] - a[1])[0][0],
      count: g.total,
    }))
    .sort((a, b) => b.count - a.count)
}

/**
 * Lista de médicos sugeridos para autocompletar, a partir de TODA la base ya
 * cacheada (cero lecturas nuevas). Junta los doctores de los tratamientos
 * (fuente de verdad) y el `doctor` denormalizado del paciente, fusiona variantes
 * y devuelve la grafía canónica de cada uno, ordenada por popularidad (desc).
 */
export function sugerenciasDoctores(patients: Patient[]): string[] {
  const docs: string[] = []
  for (const p of patients) {
    if (p.doctor) docs.push(p.doctor)
    const trats = Array.isArray(p.tratamientos)
      ? p.tratamientos
      : p.tratamientos && typeof p.tratamientos === "object"
      ? Object.values(p.tratamientos as Record<string, unknown>)
      : []
    for (const t of trats) {
      const d = (t as { doctor?: unknown })?.doctor
      if (typeof d === "string" && d.trim()) docs.push(d)
    }
  }
  return rankDerivantes(docs).map((d) => d.nombre)
}
