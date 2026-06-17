"use client"

import { useEffect, useReducer, useRef, useState } from "react"

// Caché de sesión para datos particionados por mes (logs, opiniones, turnos del
// panel admin). Los meses pasados son inmutables (logs append-only, opiniones
// cerradas), así que una vez bajados se sirven de memoria sin volver a la base.
// El mes actual se revalida en segundo plano (estilo SWR) porque puede crecer.
//
// La clave debe identificar unívocamente el dato, p. ej. `logs/2026-06`.

const cache = new Map<string, unknown>()

/** Invalida una entrada (p. ej. tras escribir en ese mes). */
export function invalidateMonth(key: string): void {
  cache.delete(key)
}

/** Borra todas las entradas cuya clave empieza con `prefix` (p. ej. al mutar). */
export function clearCachePrefix(prefix: string): void {
  for (const k of cache.keys()) {
    if (k.startsWith(prefix)) cache.delete(k)
  }
}

/** Lectura imperativa de la caché (para componentes que no usan el hook). */
export function getCachedMonth<T>(key: string): T | undefined {
  return cache.has(key) ? (cache.get(key) as T) : undefined
}

/** Escritura imperativa de la caché. */
export function setCachedMonth<T>(key: string, value: T): void {
  cache.set(key, value)
}

/**
 * Lee `key` de la caché o lo baja con `fetcher`. El render siempre lee de la
 * caché (sin parpadeo ni datos viejos al navegar entre meses ya visitados).
 *
 * - `enabled`: si es false no baja nada (para vistas lazy como Opiniones).
 * - `revalidate`: si hay dato cacheado igual vuelve a bajar en segundo plano
 *   (usar solo para el mes actual).
 * - `fallback`: valor mientras no hay dato (típicamente `[]` o `{}`).
 */
export function useCachedMonth<T>(
  key: string,
  fetcher: () => Promise<T>,
  opts: { enabled?: boolean; revalidate?: boolean; fallback: T },
): { data: T; isLoading: boolean } {
  const { enabled = true, revalidate = false, fallback } = opts
  const [, force] = useReducer((x: number) => x + 1, 0)
  // Arranca cargando si va a bajar datos y todavía no hay nada que mostrar
  const [isLoading, setIsLoading] = useState(() => enabled && !cache.has(key))
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  useEffect(() => {
    if (!enabled) return
    const hit = cache.has(key)
    if (hit && !revalidate) {
      setIsLoading(false)
      return
    }
    // Si hay algo cacheado para mostrar, no tapamos la UI con el spinner
    let cancelado = false
    setIsLoading(!hit)
    fetcherRef.current()
      .then((val) => {
        if (cancelado) return
        cache.set(key, val)
        force()
      })
      .catch(() => {
        // si falla y no había nada cacheado, queda el fallback
      })
      .finally(() => {
        if (!cancelado) setIsLoading(false)
      })
    return () => {
      cancelado = true
    }
    // fetcher se lee por ref; `key` es la identidad del dato
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, revalidate])

  const data = cache.has(key) ? (cache.get(key) as T) : fallback
  return { data, isLoading }
}
