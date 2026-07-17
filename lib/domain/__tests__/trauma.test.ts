import { describe, it, expect } from "vitest"
import { parseConsultasTrauma } from "@/lib/domain/trauma"

describe("parseConsultasTrauma", () => {
  it("ficha ausente → []", () => {
    expect(parseConsultasTrauma(null)).toEqual([])
    expect(parseConsultasTrauma(undefined)).toEqual([])
    expect(parseConsultasTrauma({})).toEqual([])
  })

  it("ordena más nuevas primero (createdAt desc)", () => {
    const out = parseConsultasTrauma({
      consultas: [
        { id: "vieja", fecha: "2026-07-01", notas: "a", usuario: "G", createdAt: 1 },
        { id: "nueva", fecha: "2026-07-10", notas: "b", usuario: "G", createdAt: 2 },
      ],
    })
    expect(out.map((c) => c.id)).toEqual(["nueva", "vieja"])
  })

  it("acepta la lista como OBJETO (mapa RTDB) y filtra huecos del formato array", () => {
    const obj = parseConsultasTrauma({
      consultas: { k1: { id: "a", notas: "x", createdAt: 1 }, k2: { id: "b", notas: "y", createdAt: 2 } } as never,
    })
    expect(obj.map((c) => c.id)).toEqual(["b", "a"])
    const arr = parseConsultasTrauma({ consultas: [null, { id: "a", notas: "x", createdAt: 1 }] as never })
    expect(arr).toHaveLength(1)
  })

  it("PRESERVA el monto cobrado (las escrituras reescriben la lista parseada: si se cae acá, se pierde en la base)", () => {
    const out = parseConsultasTrauma({
      consultas: [{ id: "a", fecha: "2026-07-10", notas: "x", usuario: "G", createdAt: 1, monto: 500 }],
    })
    expect(out[0].monto).toBe(500)
  })

  it("monto 0/ausente/basura → la clave queda AUSENTE (RTDB rechaza undefined)", () => {
    const sin = parseConsultasTrauma({ consultas: [{ id: "a", notas: "x", createdAt: 1 }] as never })[0]
    expect("monto" in sin).toBe(false)
    const cero = parseConsultasTrauma({ consultas: [{ id: "a", notas: "x", createdAt: 1, monto: 0 } as never] })[0]
    expect("monto" in cero).toBe(false)
  })

  it("diagnóstico vacío o de espacios → clave ausente", () => {
    const out = parseConsultasTrauma({ consultas: [{ id: "a", notas: "x", createdAt: 1, diagnostico: "   " } as never] })[0]
    expect("diagnostico" in out).toBe(false)
  })

  it("pliega el formato LEGACY plano ({diagnostico, notas} sueltos) como primera consulta", () => {
    const out = parseConsultasTrauma({
      diagnostico: "Lumbalgia",
      notas: "evolución favorable",
      ultima_actualizacion: { fecha: "2026-07-01T14:30:00.000Z", usuario: "Gustavo Gurpide" },
    })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      id: "legacy",
      fecha: "2026-07-01", // ISO recortado a yyyy-MM-dd
      diagnostico: "Lumbalgia",
      notas: "evolución favorable",
      usuario: "Gustavo Gurpide",
      createdAt: 0,
    })
  })

  it("si HAY consultas, el legacy plano se ignora (ya fue materializado)", () => {
    const out = parseConsultasTrauma({
      diagnostico: "viejo",
      notas: "viejo",
      consultas: [{ id: "a", notas: "nueva", createdAt: 1 }] as never,
    })
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe("a")
  })

  it("legacy plano vacío (solo espacios) NO genera consulta", () => {
    expect(parseConsultasTrauma({ diagnostico: "  ", notas: "" })).toEqual([])
  })
})
