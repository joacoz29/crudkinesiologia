// Dominio puro — libro diario: tipo de entrada, normalización de formatos
// legacy y el criterio único de "cobertura particular". Sin dependencias de
// Firebase ni de React. Movido verbatim desde lib/helpers.ts (R1; ver
// docs/architecture.md → Observaciones #5/#6). Retrocompat documentada como
// tests en lib/domain/__tests__/libro.test.ts.

import { Especialidad } from "@/types"

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
