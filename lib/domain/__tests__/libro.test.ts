import { describe, it, expect } from "vitest"
import { esParticular, normalizeLibroEntradas } from "@/lib/domain/libro"

describe("esParticular", () => {
  it("vacío, '-' y 'particular' (cualquier caso/espacios) son Particular", () => {
    expect(esParticular("")).toBe(true)
    expect(esParticular("-")).toBe(true)
    expect(esParticular("particular")).toBe(true)
    expect(esParticular("PARTICULAR")).toBe(true)
    expect(esParticular("  Particular  ")).toBe(true)
    expect(esParticular(null)).toBe(true)
    expect(esParticular(undefined)).toBe(true)
  })

  it("una obra social real NO es particular", () => {
    expect(esParticular("IOMA")).toBe(false)
    expect(esParticular("PAMI")).toBe(false)
    expect(esParticular("OSDE 210")).toBe(false)
  })
})

describe("normalizeLibroEntradas", () => {
  const entrada = (over: object = {}) => ({
    nombreApellido: "Perez Juan",
    cobertura: "Particular" as const,
    obraSocial: "-",
    debe: 0,
    haber: 100,
    ...over,
  })

  it("null → []", () => {
    expect(normalizeLibroEntradas(null)).toEqual([])
    expect(normalizeLibroEntradas(undefined)).toEqual([])
  })

  it("formato ARRAY (legacy): filtra huecos, tipo default 'Paciente', createdAt = índice si falta", () => {
    const out = normalizeLibroEntradas([null, entrada({ id: "a" }), entrada({ id: "b" })])
    expect(out).toHaveLength(2)
    expect(out[0].tipo).toBe("Paciente")
    // el índice del array ES el orden de carga para entradas legacy sin sello
    expect(out.map((e) => e.id)).toEqual(["a", "b"])
    expect(out[0].createdAt).toBe(1)
    expect(out[1].createdAt).toBe(2)
  })

  it("formato ARRAY sin id interno → genera uno (nunca entradas sin identidad)", () => {
    const out = normalizeLibroEntradas([entrada()])
    expect(out[0].id).toBeTruthy()
  })

  it("formato MAPA: la CLAVE manda como id (identidad estable de los updates)", () => {
    const out = normalizeLibroEntradas({ k1: entrada({ id: "otro" }) })
    expect(out[0].id).toBe("k1")
  })

  it("ordena por createdAt asc; las entradas sin sello quedan primero", () => {
    const out = normalizeLibroEntradas({
      a: entrada({ createdAt: 200 }),
      b: entrada(),
      c: entrada({ createdAt: 100 }),
    })
    expect(out.map((e) => e.id)).toEqual(["b", "c", "a"])
  })

  it("preserva el tag de especialidad de los cobros de trauma", () => {
    const out = normalizeLibroEntradas({ k: entrada({ especialidad: "traumatologia" }) })
    expect(out[0].especialidad).toBe("traumatologia")
  })
})
