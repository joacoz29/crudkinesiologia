// Feriados nacionales (fecha yyyy-MM-dd → nombre), vía /api/feriados.
//
// Caché por año a nivel módulo, compartida en toda la app (Calendario y la
// pestaña Pendientes). El endpoint /api/feriados ya está cacheado 24h en el
// server; esto evita además re-pedirlo desde el cliente entre componentes y
// montajes. Los feriados de un año son inmutables, así que no se revalidan.

const cache = new Map<number, Record<string, string>>()

async function fetchYear(year: number): Promise<Record<string, string>> {
  const hit = cache.get(year)
  if (hit) return hit
  try {
    const res = await fetch(`/api/feriados?year=${year}`)
    if (!res.ok) return {}
    const data: { fecha: string; nombre: string }[] = await res.json()
    const map: Record<string, string> = {}
    for (const f of data) map[f.fecha] = f.nombre
    cache.set(year, map)
    return map
  } catch {
    return {}
  }
}

/** Feriados de los años pedidos, mergeados en un solo mapa. Cacheado por año. */
export async function fetchFeriados(years: number[]): Promise<Record<string, string>> {
  const maps = await Promise.all(years.map(fetchYear))
  return Object.assign({}, ...maps)
}
