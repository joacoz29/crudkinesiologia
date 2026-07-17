// Acceso a datos — libro diario (caja): alta de entradas y resumen por rango.
// Movido verbatim desde lib/helpers.ts (R2; ver docs/architecture.md → obs #6).
// La normalización/criterios puros viven en lib/domain/libro.

import { ref, get, update, query, orderByKey, startAt, endAt } from "firebase/database"
import { format } from "date-fns-tz"
import { db } from "@/lib/firebase"
import { Especialidad } from "@/types"
import { ESPECIALIDADES_LIST, espDe } from "@/lib/especialidades"
import { TZ } from "@/lib/domain/tiempo"
import { esParticular, normalizeLibroEntradas, type LibroDiarioEntry } from "@/lib/domain/libro"

// Prepara UNA entrada de paciente para el libro diario del día, o null si el
// paciente ya tiene entrada ese día. Devuelve solo la entrada + su id para
// escribirla de forma puntual (`entradas/{id}`), sin tocar las demás entradas
// (evita el lost-update con quien esté editando el libro en simultáneo).
// Exportada porque el flujo de asistencia (lib/flujo/asistencia) la fusiona en
// su escritura multi-path.
export async function buildLibroDiarioEntry(
  dateKey: string,
  nombreApellido: string,
  obraSocial: string
): Promise<{ entryId: string; entry: LibroDiarioEntry } | null> {
  const snapshot = await get(ref(db, `libroDiario/${dateKey}/entradas`))
  const entradas = normalizeLibroEntradas(snapshot.val())

  // Skip if this patient already has an entry for this date
  if (entradas.some((e) => e.nombreApellido === nombreApellido)) return null

  const entryId = crypto.randomUUID()
  const particular = esParticular(obraSocial)
  const entry: LibroDiarioEntry = {
    id: entryId,
    tipo: "Paciente",
    nombreApellido,
    cobertura: particular ? "Particular" : "Obra Social",
    obraSocial: particular ? "-" : obraSocial,
    debe: 0,
    haber: 0,
    createdAt: Date.now(),
  }
  return { entryId, entry }
}

export async function addToLibroDiario(entry: {
  nombreApellido: string
  obraSocial: string
  fecha?: string
}) {
  // Fecha local de Argentina, no UTC (toISOString cae en "mañana" después de las 21:00)
  const dateKey = entry.fecha ?? format(new Date(), "yyyy-MM-dd", { timeZone: TZ })
  const result = await buildLibroDiarioEntry(dateKey, entry.nombreApellido, entry.obraSocial)
  if (!result) return
  await update(ref(db), {
    [`libroDiario/${dateKey}/fecha`]: dateKey,
    [`libroDiario/${dateKey}/entradas/${result.entryId}`]: result.entry,
  })
}

// Prepara las rutas de un cobro de traumatología para el Libro Diario (caja),
// para fusionarlas en la MISMA escritura multi-path que guarda la consulta (todo
// o nada: no queda una consulta con cobro sin su movimiento en el libro, ni al
// revés). A diferencia de las sesiones de kine (fila en $0 que completa recepción),
// acá el traumatólogo ya sabe lo que cobró: haber directo, taggeado como
// traumatología. Sin dedup por paciente/día: cada consulta cobrada es un
// movimiento propio (un paciente puede tener kine y trauma el mismo día).
export function cobroTraumaUpdates(entry: {
  nombreApellido: string
  obraSocial: string
  monto: number
  fecha: string // yyyy-MM-dd
}): Record<string, unknown> {
  if (!entry.monto || entry.monto <= 0) return {}
  const particular = esParticular(entry.obraSocial)
  const entryId = crypto.randomUUID()
  const libroEntry: LibroDiarioEntry = {
    id: entryId,
    tipo: "Paciente",
    nombreApellido: entry.nombreApellido,
    cobertura: particular ? "Particular" : "Obra Social",
    obraSocial: particular ? "-" : entry.obraSocial,
    debe: 0,
    haber: entry.monto,
    especialidad: "traumatologia",
    createdAt: Date.now(),
  }
  return {
    [`libroDiario/${entry.fecha}/fecha`]: entry.fecha,
    [`libroDiario/${entry.fecha}/entradas/${entryId}`]: libroEntry,
  }
}

// Una "tajada" del resumen: haber/debe por día + desglose por cobertura/tipo.
// Se usa tanto para el total como para cada especialidad.
export interface LibroResumenSlice {
  porDia: Record<string, { haber: number; debe: number }>
  // Desglose de la recaudación (haber) y egresos (debe) del rango
  haberParticular: number // pacientes Particular
  haberObraSocial: number // pacientes con Obra Social
  haberIngreso: number    // entradas tipo Ingreso
  debeGasto: number       // entradas tipo Gasto
}

// El total (campos planos, retrocompat) + el mismo desglose partido por
// especialidad (kinesiología incluye las entradas legacy sin tag).
export interface LibroResumen extends LibroResumenSlice {
  porEspecialidad: Record<Especialidad, LibroResumenSlice>
}

export function emptyLibroSlice(): LibroResumenSlice {
  return { porDia: {}, haberParticular: 0, haberObraSocial: 0, haberIngreso: 0, debeGasto: 0 }
}

// Resumen del libro diario en un rango (claves yyyy-MM-dd): haber/debe por día
// + desglose por cobertura/tipo. Computa todo en una sola lectura sumando las
// entradas (los totales denormalizados se dropearon).
export async function fetchLibroDiarioPorRango(
  start: string,
  end: string
): Promise<LibroResumen> {
  const q = query(ref(db, "libroDiario"), orderByKey(), startAt(start), endAt(end))
  const snapshot = await get(q)

  const total = emptyLibroSlice()
  // Una tajada por especialidad, derivada del registry (sumar una especialidad
  // no requiere tocar esto). Las entradas sin tag caen en el default (kine).
  const porEspecialidad = Object.fromEntries(
    ESPECIALIDADES_LIST.map((e) => [e, emptyLibroSlice()]),
  ) as Record<Especialidad, LibroResumenSlice>

  // Acumula una entrada (haber/debe por día + desglose por cobertura/tipo) en una tajada.
  const acumular = (s: LibroResumenSlice, fecha: string, e: LibroDiarioEntry) => {
    const h = Number(e.haber) || 0
    const d = Number(e.debe) || 0
    const dia = s.porDia[fecha] ?? (s.porDia[fecha] = { haber: 0, debe: 0 })
    dia.haber += h
    dia.debe += d
    const tipo = e.tipo ?? "Paciente"
    if (tipo === "Ingreso") s.haberIngreso += h
    else if (tipo === "Gasto") s.debeGasto += d
    else if (!esParticular(e.obraSocial)) s.haberObraSocial += h
    else s.haberParticular += h
  }

  if (snapshot.exists()) {
    snapshot.forEach((daySnap) => {
      const fecha = daySnap.key!
      const entradas = normalizeLibroEntradas((daySnap.val() as { entradas?: unknown })?.entradas)
      for (const e of entradas) {
        acumular(total, fecha, e)
        acumular(porEspecialidad[espDe(e)], fecha, e)
      }
    })
  }
  return { ...total, porEspecialidad }
}
