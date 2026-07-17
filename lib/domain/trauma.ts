// Dominio puro — traumatología: (de)serialización del historial de consultas.
// Sin dependencias de Firebase ni de React. Movido verbatim desde
// lib/helpers.ts (R1; ver docs/architecture.md → Observaciones #5/#6).
// Retrocompat documentada como tests en lib/domain/__tests__/trauma.test.ts.

import { TraumatologiaFicha, TraumatologiaConsulta } from "@/types"

function normalizeConsultaTrauma(item: unknown): TraumatologiaConsulta {
  const c = item as Record<string, unknown>
  return {
    id: String(c.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    fecha: String(c.fecha ?? ""),
    ...(!!(c.diagnostico != null && String(c.diagnostico).trim()) && { diagnostico: String(c.diagnostico) }),
    notas: String(c.notas ?? ""),
    // Preservar el monto es crítico: las escrituras reescriben la lista completa
    // desde el estado parseado — si se cayera acá, se perdería en la base.
    ...(Number(c.monto) > 0 && { monto: Number(c.monto) }),
    usuario: String(c.usuario ?? ""),
    createdAt: Number(c.createdAt ?? 0),
  }
}

// Historial de consultas de traumatología, más nuevas primero. Acepta la lista
// como array u objeto (retrocompat RTDB) y pliega el formato legacy plano
// ({diagnostico, notas} sueltos) como una consulta, para no perder lo ya cargado.
export function parseConsultasTrauma(ficha: TraumatologiaFicha | undefined | null): TraumatologiaConsulta[] {
  if (!ficha) return []
  const raw: unknown = ficha.consultas
  let list: TraumatologiaConsulta[] = []
  if (Array.isArray(raw)) list = raw.filter(Boolean).map(normalizeConsultaTrauma)
  else if (raw && typeof raw === "object") list = Object.values(raw as object).filter(Boolean).map(normalizeConsultaTrauma)
  if (list.length === 0 && ((ficha.diagnostico ?? "").trim() || (ficha.notas ?? "").trim())) {
    list = [{
      id: "legacy",
      fecha: (ficha.ultima_actualizacion?.fecha ?? "").slice(0, 10),
      ...(!!(ficha.diagnostico ?? "").trim() && { diagnostico: String(ficha.diagnostico) }),
      notas: (ficha.notas ?? "").trim(),
      usuario: ficha.ultima_actualizacion?.usuario ?? "",
      createdAt: 0,
    }]
  }
  return list.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
}
