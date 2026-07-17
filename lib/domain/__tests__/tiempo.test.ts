import { describe, it, expect } from "vitest"
import { horaToMin, minToHora, TZ } from "@/lib/domain/tiempo"

describe("tiempo", () => {
  it("TZ es la hora argentina (las claves de fecha dependen de esto)", () => {
    expect(TZ).toBe("America/Argentina/Buenos_Aires")
  })

  it("horaToMin convierte HH:MM a minutos del día", () => {
    expect(horaToMin("00:00")).toBe(0)
    expect(horaToMin("09:30")).toBe(570)
    expect(horaToMin("19:05")).toBe(1145)
  })

  it("horaToMin tolera basura sin tirar (devuelve 0)", () => {
    expect(horaToMin("")).toBe(0)
    expect(horaToMin("zzz")).toBe(0)
    // @ts-expect-error — el runtime puede recibir undefined desde datos legacy
    expect(horaToMin(undefined)).toBe(0)
  })

  it("minToHora formatea con padding y clampea a [00:00, 23:59]", () => {
    expect(minToHora(570)).toBe("09:30")
    expect(minToHora(65)).toBe("01:05")
    expect(minToHora(-10)).toBe("00:00")
    expect(minToHora(24 * 60)).toBe("23:59")
  })

  it("horaToMin y minToHora hacen round-trip", () => {
    for (const h of ["08:00", "13:45", "23:59"]) {
      expect(minToHora(horaToMin(h))).toBe(h)
    }
  })
})
