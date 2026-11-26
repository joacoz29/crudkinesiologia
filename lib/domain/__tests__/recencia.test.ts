import { describe, it, expect } from "vitest"
import { recenciaPacientes, ordenarPorRecencia, etiquetaRecencia, type Tarea } from "@/lib/tareas"
import type { Patient, Turno } from "@/types"

const HOY = "2026-11-26"
const pac = (id: string, createdAt?: number) => ({ id, nombre: "X", apellido: "Y", createdAt }) as unknown as Patient
const turno = (patientId: string, estado: Turno["estado"]) =>
  ({ id: `t-${patientId}-${estado}`, patientId, nombre: "X", apellido: "Y", hora: "09:00", estado }) as Turno
const viejo = Date.UTC(2020, 0, 1)

describe("recenciaPacientes", () => {
  it("toma la última asistencia dentro de los 30 días e ignora ausencias, futuros y lo viejo", () => {
    const turnos = {
      "2026-10-01": [turno("a", "asistio")], // fuera de los 30 días
      "2026-11-10": [turno("a", "asistio"), turno("b", "ausente")],
      "2026-11-20": [turno("a", "asistio")],
      "2026-11-30": [turno("c", "asistio")], // futuro (no debería pasar, pero se ignora)
    }
    const r = recenciaPacientes([pac("a", viejo), pac("b", viejo), pac("c", viejo)], turnos, HOY)
    expect(r.get("a")).toEqual({ fecha: "2026-11-20", motivo: "vino" })
    expect(r.has("b")).toBe(false)
    expect(r.has("c")).toBe(false)
  })

  it("un paciente dado de alta hace poco cuenta aunque no haya venido", () => {
    const alta = Date.UTC(2026, 10, 24, 15) // 24/11 12:00 AR
    expect(recenciaPacientes([pac("n", alta)], {}, HOY).get("n")).toEqual({ fecha: "2026-11-24", motivo: "alta" })
  })

  it("si vino después del alta, gana la asistencia", () => {
    const alta = Date.UTC(2026, 10, 20, 15)
    const r = recenciaPacientes([pac("n", alta)], { "2026-11-25": [turno("n", "asistio")] }, HOY)
    expect(r.get("n")).toEqual({ fecha: "2026-11-25", motivo: "vino" })
  })
})

describe("ordenarPorRecencia", () => {
  const t = (id: string, patientId: string): Tarea =>
    ({ id, patientId, categoria: "datos", severidad: "media", titulo: id, descripcion: "" })

  it("recientes primero (más reciente arriba), el resto conserva su orden y suma la etiqueta", () => {
    const recencia = new Map([
      ["b", { fecha: "2026-11-20", motivo: "vino" as const }],
      ["d", { fecha: "2026-11-25", motivo: "alta" as const }],
    ])
    const out = ordenarPorRecencia([t("1", "a"), t("2", "b"), t("3", "c"), t("4", "d"), t("5", "b")], recencia, HOY)
    expect(out.map((x) => x.id)).toEqual(["4", "2", "5", "1", "3"])
    expect(out[0].reciente).toBe("Alta ayer")
    expect(out[3].reciente).toBeUndefined()
  })
})

describe("etiquetaRecencia", () => {
  it("hoy / ayer / hace N días", () => {
    expect(etiquetaRecencia({ fecha: HOY, motivo: "vino" }, HOY)).toBe("Vino hoy")
    expect(etiquetaRecencia({ fecha: "2026-11-25", motivo: "vino" }, HOY)).toBe("Vino ayer")
    expect(etiquetaRecencia({ fecha: "2026-11-16", motivo: "alta" }, HOY)).toBe("Alta hace 10 días")
  })
})
