import { describe, it, expect } from "vitest"
import {
  countSesionesEnHistorial,
  getNextSessionNumber,
  appendSesionAlHistorial,
  parseTratamientosRaw,
  getSessionStats,
} from "@/lib/domain/paciente"
import { Patient } from "@/types"

// ─── Historial libre ("N- fecha hora") ───────────────────────────────────────

describe("countSesionesEnHistorial", () => {
  it("cuenta las sesiones 'N-' seguidas de espacio o fin de texto", () => {
    expect(countSesionesEnHistorial("1- 28/3/23 10:00\n2- 30/3/23 10:00")).toBe(2)
    expect(countSesionesEnHistorial("7-")).toBe(1) // fin de texto
    expect(countSesionesEnHistorial("")).toBe(0)
  })

  it("NO cuenta teléfonos ni fechas anotados en el mismo campo (lookahead)", () => {
    // "02320-659087": el guion va seguido de dígito, no de espacio → no es sesión
    expect(countSesionesEnHistorial("tel 02320-659087")).toBe(0)
    // "2026-06-10": ídem
    expect(countSesionesEnHistorial("control 2026-06-10")).toBe(0)
    // Mezcla: solo cuenta las reales
    expect(countSesionesEnHistorial("1- 28/3 tel 02320-659087 2- 30/3")).toBe(2)
  })
})

describe("getNextSessionNumber", () => {
  it("arranca en 1 con historial vacío", () => {
    expect(getNextSessionNumber("")).toBe(1)
  })

  it("devuelve max + 1 (no cantidad + 1): tolera huecos en la numeración", () => {
    expect(getNextSessionNumber("1- a 2- b")).toBe(3)
    expect(getNextSessionNumber("5- a 2- b")).toBe(6)
  })
})

describe("appendSesionAlHistorial", () => {
  it("primera sesión: sin salto de línea inicial", () => {
    expect(appendSesionAlHistorial("", "10/07/2026 09:00")).toBe("1- 10/07/2026 09:00")
  })

  it("agrega en línea nueva con el número siguiente", () => {
    expect(appendSesionAlHistorial("1- 08/07/2026 09:00", "10/07/2026 09:00")).toBe(
      "1- 08/07/2026 09:00\n2- 10/07/2026 09:00",
    )
  })
})

// ─── Tratamientos (retrocompat RTDB: array u objeto; sesiones string[]|objeto) ─

describe("parseTratamientosRaw", () => {
  it("null/undefined/vacío → []", () => {
    expect(parseTratamientosRaw(null)).toEqual([])
    expect(parseTratamientosRaw(undefined)).toEqual([])
    expect(parseTratamientosRaw(0)).toEqual([])
  })

  it("acepta el formato array y filtra huecos (RTDB deja nulls en arrays ralos)", () => {
    const out = parseTratamientosRaw([
      null,
      { id: "a", nroAutorizacion: "123", sesionesAutorizadas: 10, fechaCreacion: "2024-01-01", sesiones: ["Sesión 1"] },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe("a")
    expect(out[0].sesiones).toEqual(["Sesión 1"])
  })

  it("acepta el formato objeto (mapa RTDB) → values", () => {
    const out = parseTratamientosRaw({
      k1: { id: "a", sesionesAutorizadas: 5, sesiones: ["s1", "s2"] },
      k2: { id: "b", sesiones: [] },
    })
    expect(out.map((t) => t.id)).toEqual(["a", "b"])
  })

  it("sesiones como OBJETO (mapa RTDB) se convierte a array filtrando falsy", () => {
    const out = parseTratamientosRaw([{ id: "a", sesiones: { s0: "Sesión 1", s1: null, s2: "Sesión 2" } }])
    expect(out[0].sesiones).toEqual(["Sesión 1", "Sesión 2"])
  })

  it("sesiones ausente → [] y defaults numéricos/string", () => {
    const out = parseTratamientosRaw([{}])
    expect(out[0].sesiones).toEqual([])
    expect(out[0].nroAutorizacion).toBe("")
    expect(out[0].sesionesAutorizadas).toBe(0)
    expect(out[0].fechaCreacion).toBe("")
    expect(typeof out[0].id).toBe("string")
  })

  it("los campos opcionales solo aparecen si venían (RTDB rechaza undefined)", () => {
    const sin = parseTratamientosRaw([{ id: "a" }])[0]
    expect("doctor" in sin).toBe(false)
    expect("diagnostico" in sin).toBe(false)
    expect("tratamiento" in sin).toBe(false)
    const con = parseTratamientosRaw([{ id: "a", doctor: "Gurpide" }])[0]
    expect(con.doctor).toBe("Gurpide")
  })
})

// ─── Stats de sesiones (nuevo esquema con fallback legacy) ───────────────────

describe("getSessionStats", () => {
  const base = { id: "p", nombre: "A", apellido: "B", edad: "", dni: "", obraSocial: "", nroAFL: "", telefono: "", sesiones: [] as string[] }

  it("suma los tratamientos del acordeón cuando existen", () => {
    const p = {
      ...base,
      tratamientos: [
        { id: "1", nroAutorizacion: "", sesionesAutorizadas: 10, fechaCreacion: "", sesiones: ["a", "b"] },
        { id: "2", nroAutorizacion: "", sesionesAutorizadas: 5, fechaCreacion: "", sesiones: ["c"] },
      ],
    } as Patient
    expect(getSessionStats(p)).toEqual({ used: 3, authorized: 15 })
  })

  it("cae al esquema legacy: sesionesAutorizadas del paciente + conteo del historial", () => {
    const p = { ...base, sesionesAutorizadas: 10, sesiones: ["1- 28/3 2- 30/3"] } as Patient
    expect(getSessionStats(p)).toEqual({ used: 2, authorized: 10 })
  })

  it("null si no hay autorizadas en ningún esquema", () => {
    expect(getSessionStats(base as Patient)).toBeNull()
  })
})
