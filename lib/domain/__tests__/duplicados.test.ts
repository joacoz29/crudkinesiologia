import { describe, it, expect } from "vitest"
import { clasificarDuplicado } from "@/lib/domain/duplicados"

const p = (nombre: string, apellido: string) => ({ nombre, apellido })

describe("clasificarDuplicado", () => {
  it("mismo nombre y apellido, ignorando mayúsculas, acentos y espacios", () => {
    expect(clasificarDuplicado([p("María", "Pérez"), p("MARIA ", "perez")])).toBe("misma_persona")
  })

  it("nombre o apellido compuesto en una sola de las fichas", () => {
    expect(clasificarDuplicado([p("Maria", "Garcia"), p("Maria Jose", "Garcia Lopez")])).toBe("misma_persona")
    expect(clasificarDuplicado([p("Ana Maria", "Diaz"), p("Maria", "Diaz")])).toBe("misma_persona")
  })

  it("apellido distinto → revisar (DNI mal cargado)", () => {
    expect(clasificarDuplicado([p("Juan", "Perez"), p("Juan", "Gomez")])).toBe("revisar")
  })

  it("mismo apellido pero otro nombre (p. ej. un familiar) → revisar", () => {
    expect(clasificarDuplicado([p("Juan", "Perez"), p("Lucia", "Perez")])).toBe("revisar")
  })

  it("un typo también va a revisar (ante la duda no se fusiona)", () => {
    expect(clasificarDuplicado([p("Juan", "Rodriguez"), p("Juan", "Rodrigez")])).toBe("revisar")
  })

  it("grupo de 3: basta una ficha distinta para revisar", () => {
    expect(clasificarDuplicado([p("Juan", "Perez"), p("juan", "PEREZ"), p("Juan", "Paz")])).toBe("revisar")
  })

  it("nombres vacíos → revisar", () => {
    expect(clasificarDuplicado([p("", ""), p("Juan", "Perez")])).toBe("revisar")
  })
})
