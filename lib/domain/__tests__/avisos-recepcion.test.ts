import { describe, it, expect } from "vitest"
import { computeAvisosRecepcion } from "@/lib/avisos-recepcion"
import { pacientesActivos, ultimaActividadMs, camposFaltantes } from "@/lib/tareas"
import type { Patient, Turno } from "@/types"

const HOY = "2026-11-26"
const MANANA = "2026-11-27"

const completo = {
  telefono: "1166249792",
  dni: "30123456",
  obraSocial: "IOMA",
  diagnostico: "Lumbalgia",
  edad: "40",
}
const pac = (id: string, over: Record<string, unknown> = {}) =>
  ({ id, nombre: "Juan", apellido: id.toUpperCase(), ...completo, ...over }) as unknown as Patient
const turno = (patientId: string, hora: string, estado: Turno["estado"] = "pendiente") =>
  ({ id: `t-${patientId}-${hora}`, patientId, nombre: "Juan", apellido: patientId.toUpperCase(), hora, estado }) as Turno
const agotado = {
  tratamientos: [{ id: "x", nroAutorizacion: "1", sesionesAutorizadas: 2, sesiones: ["a", "b"] }],
}

const base = { hoyKey: HOY, mananaKey: MANANA, nowMin: 10 * 60, cierres: [] }

describe("computeAvisosRecepcion", () => {
  it("datos incompletos de quien viene hoy, con qué pedirle", () => {
    const avisos = computeAvisosRecepcion({
      ...base,
      patients: [pac("a", { telefono: "", dni: "" }), pac("b")],
      turnosPorFecha: { [HOY]: [turno("a", "10:00"), turno("b", "11:00")] },
    })
    expect(avisos).toHaveLength(1)
    expect(avisos[0].tipo).toBe("datos")
    expect(avisos[0].texto).toBe("Hoy 10:00 viene Juan A: pedile teléfono y DNI.")
    expect(avisos[0].accion).toEqual({ tipo: "ficha", patientId: "a" })
  })

  it("reautorizar va primero; cancelados no cuentan; un paciente que viene hoy y mañana avisa una vez", () => {
    const avisos = computeAvisosRecepcion({
      ...base,
      patients: [pac("a", { telefono: "" }), pac("b", agotado), pac("c", { dni: "" })],
      turnosPorFecha: {
        [HOY]: [turno("a", "09:00"), turno("c", "12:00", "cancelado")],
        [MANANA]: [turno("a", "09:00"), turno("b", "08:00")],
      },
    })
    expect(avisos.map((a) => a.id)).toEqual([`reautorizar:b:${MANANA}`, `datos:a:${HOY}`])
  })

  it("turnos de hoy sin marcar solo a partir de las 17 y si ya pasó la hora", () => {
    const turnosPorFecha = { [HOY]: [turno("a", "09:00"), turno("b", "18:30"), turno("c", "10:00", "asistio")] }
    const patients = [pac("a"), pac("b"), pac("c")]
    expect(computeAvisosRecepcion({ ...base, patients, turnosPorFecha, nowMin: 16 * 60 })).toEqual([])
    const tarde = computeAvisosRecepcion({ ...base, patients, turnosPorFecha, nowMin: 17 * 60 + 5 })
    expect(tarde.map((a) => a.texto)).toEqual(["Queda 1 turno de hoy sin marcar asistencia."])
  })

  it("días cerrados con pendientes", () => {
    const avisos = computeAvisosRecepcion({
      ...base,
      patients: [],
      turnosPorFecha: {},
      cierres: [{ fecha: "2026-12-24", motivo: "Nochebuena", pendientes: 17 }, { fecha: "2026-12-25", motivo: "Navidad", pendientes: 0 }],
    })
    expect(avisos).toHaveLength(1)
    expect(avisos[0].texto).toContain("El 24/12 está cerrado (Nochebuena) y quedan 17 turnos pendientes")
    expect(avisos[0].accion).toEqual({ tipo: "calendario", fecha: "2026-12-24" })
  })
})

describe("fichas antiguas", () => {
  it("lee ultima_actualizacion ISO y legacy día/mes", () => {
    const iso = pac("a", { ultima_actualizacion: { fecha: "2026-11-20T15:00:00.000Z", usuario: "x" } })
    const legacy = pac("b", { ultima_actualizacion: { fecha: "14:05:00 20/11/2026", usuario: "x" } })
    expect(ultimaActividadMs(iso)).toBe(Date.parse("2026-11-20T15:00:00.000Z"))
    expect(ultimaActividadMs(legacy)).toBe(Date.parse("2026-11-20T17:05:00.000Z"))
  })

  it("activo si tuvo actividad en ~6 meses o tiene un turno desde entonces", () => {
    const patients = [
      pac("reciente", { ultima_actualizacion: { fecha: "10:00:00 1/10/2026", usuario: "x" } }),
      pac("viejo", { ultima_actualizacion: { fecha: "10:00:00 1/3/2024", usuario: "x" } }),
      pac("vuelve", { ultima_actualizacion: { fecha: "10:00:00 1/3/2024", usuario: "x" } }),
    ]
    const activos = pacientesActivos(patients, { "2026-12-02": [turno("vuelve", "10:00")] }, HOY)
    expect([...activos].sort()).toEqual(["reciente", "vuelve"])
  })

  it("camposFaltantes lista lo que falta", () => {
    expect(camposFaltantes(pac("a"))).toEqual([])
    expect(camposFaltantes(pac("a", { telefono: " ", diagnostico: "" }))).toEqual(["teléfono", "diagnóstico"])
  })
})
