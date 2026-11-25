import { describe, it, expect } from "vitest"
import { noLaborableDe, fechasEntre } from "@/lib/domain/no-laborables"

describe("noLaborableDe", () => {
  it("24, 25 y 31 de diciembre y 1 de enero son cierre anual, cualquier año", () => {
    for (const f of ["2026-12-24", "2026-12-25", "2026-12-31", "2027-01-01", "2030-12-24"]) {
      expect(noLaborableDe(f, {})?.tipo).toBe("anual")
    }
    expect(noLaborableDe("2026-12-24", {})?.motivo).toBe("Nochebuena")
  })

  it("un día común es laborable", () => {
    expect(noLaborableDe("2026-12-23", {})).toBeNull()
    expect(noLaborableDe("2027-01-02", {})).toBeNull()
  })

  it("un día marcado a mano no es laborable y su motivo gana sobre el anual", () => {
    const manuales = {
      "2026-12-08": { motivo: "Vacaciones", por: "Ana" },
      "2026-12-24": { motivo: "Cierre especial" },
    }
    expect(noLaborableDe("2026-12-08", manuales)).toEqual({ motivo: "Vacaciones", tipo: "manual", por: "Ana" })
    expect(noLaborableDe("2026-12-24", manuales)?.motivo).toBe("Cierre especial")
  })
})

describe("fechasEntre", () => {
  it("incluye ambos extremos y cruza meses/años", () => {
    expect(fechasEntre("2026-12-30", "2027-01-02")).toEqual([
      "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02",
    ])
  })

  it("un solo día, y rango invertido vacío", () => {
    expect(fechasEntre("2026-12-08", "2026-12-08")).toEqual(["2026-12-08"])
    expect(fechasEntre("2026-12-09", "2026-12-08")).toEqual([])
  })

  it("no se corre de día por horario de verano ni timezone", () => {
    expect(fechasEntre("2026-03-28", "2026-03-31")).toHaveLength(4)
  })
})
