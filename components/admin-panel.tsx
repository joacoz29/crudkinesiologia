"use client"

import { useEffect, useState } from "react"
import { ref, get } from "firebase/database"
import { db } from "@/lib/firebase"
import { format, parseISO, isValid, addMonths, subMonths } from "date-fns"
import { es } from "date-fns/locale"
import { ChevronLeft, ChevronRight, Shield } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

interface LogCambio {
  antes: string
  despues: string
}

interface LogEntry {
  id: string
  timestamp: string
  email: string
  displayName: string
  accion: string
  detalle: string
  entidadId?: string
  cambios?: Record<string, LogCambio>
}

const ACCION_LABEL: Record<string, string> = {
  crear_paciente: "Crear paciente",
  editar_paciente: "Editar paciente",
  eliminar_paciente: "Eliminar paciente",
  confirmar_asistencia: "Confirmar asistencia",
  crear_turno: "Crear turno",
  editar_turno: "Editar turno",
  eliminar_turno: "Eliminar turno",
  eliminar_todos_turnos: "Eliminar todos los turnos",
}

const ACCION_CRITICA = new Set(["eliminar_paciente", "eliminar_todos_turnos"])

function accionBadgeClass(accion: string): string {
  if (accion.startsWith("crear")) return "bg-green-50 text-green-700 border-green-200"
  if (accion.startsWith("editar")) return "bg-blue-50 text-blue-700 border-blue-200"
  if (accion.startsWith("eliminar")) return "bg-red-50 text-red-700 border-red-200"
  if (accion === "confirmar_asistencia") return "bg-violet-50 text-violet-700 border-violet-200"
  return "bg-gray-50 text-gray-600 border-gray-200"
}

export function AdminPanel() {
  const [currentMonth, setCurrentMonth] = useState(() => new Date())
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [filterUser, setFilterUser] = useState("todos")
  const [filterAccion, setFilterAccion] = useState("todas")
  const [searchPaciente, setSearchPaciente] = useState("")

  const mesKey = format(currentMonth, "yyyy-MM")

  useEffect(() => {
    setIsLoading(true)
    get(ref(db, `logs/${mesKey}`))
      .then((snap) => {
        if (!snap.exists()) { setLogs([]); return }
        const entries: LogEntry[] = Object.entries(snap.val() as Record<string, Omit<LogEntry, "id">>)
          .map(([id, val]) => ({ id, ...val }))
          .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
        setLogs(entries)
      })
      .catch(() => setLogs([]))
      .finally(() => setIsLoading(false))
  }, [mesKey])

  const usuarios = ["todos", ...Array.from(new Set(logs.map((l) => l.displayName)))]
  const acciones = ["todas", ...Array.from(new Set(logs.map((l) => l.accion)))]

  const filtered = logs.filter((l) => {
    if (filterUser !== "todos" && l.displayName !== filterUser) return false
    if (filterAccion !== "todas" && l.accion !== filterAccion) return false
    if (searchPaciente.trim()) {
      const q = searchPaciente.toLowerCase()
      if (!l.detalle.toLowerCase().includes(q)) return false
    }
    return true
  })

  // Resumen por usuario (sobre logs sin filtrar del mes)
  const resumenUsuarios = Array.from(
    logs.reduce((map, l) => {
      map.set(l.displayName, (map.get(l.displayName) ?? 0) + 1)
      return map
    }, new Map<string, number>())
  ).sort((a, b) => b[1] - a[1])

  const mesLabel = format(currentMonth, "MMMM yyyy", { locale: es })

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Shield className="h-5 w-5 text-[#001633]" />
        <h2 className="text-2xl font-semibold text-[#001633]">Panel de administración</h2>
      </div>

      {/* Resumen del mes */}
      {!isLoading && resumenUsuarios.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {resumenUsuarios.map(([nombre, count]) => (
            <div key={nombre} className="bg-white rounded-xl border border-slate-200 px-4 py-3 shadow-sm flex items-center gap-3">
              <div className="h-8 w-8 rounded-full bg-[#001633] flex items-center justify-center text-white text-xs font-semibold shrink-0">
                {nombre.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-800">{nombre}</p>
                <p className="text-xs text-slate-400">{count} acción{count !== 1 ? "es" : ""} este mes</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Navegación de mes + filtros */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => setCurrentMonth((m) => subMonths(m, 1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium text-slate-700 capitalize w-36 text-center">{mesLabel}</span>
          <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => setCurrentMonth((m) => addMonths(m, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex gap-2 flex-wrap items-center">
          <Input
            placeholder="Buscar paciente..."
            value={searchPaciente}
            onChange={(e) => setSearchPaciente(e.target.value)}
            className="h-8 text-sm w-44 border-slate-200 focus:border-[#001633]"
          />
          <select
            value={filterUser}
            onChange={(e) => setFilterUser(e.target.value)}
            className="text-sm border border-slate-200 rounded-md px-2 py-1.5 bg-white text-slate-700 focus:outline-none focus:border-[#001633]"
          >
            {usuarios.map((u) => (
              <option key={u} value={u}>{u === "todos" ? "Todos los usuarios" : u}</option>
            ))}
          </select>
          <select
            value={filterAccion}
            onChange={(e) => setFilterAccion(e.target.value)}
            className="text-sm border border-slate-200 rounded-md px-2 py-1.5 bg-white text-slate-700 focus:outline-none focus:border-[#001633]"
          >
            {acciones.map((a) => (
              <option key={a} value={a}>{a === "todas" ? "Todas las acciones" : (ACCION_LABEL[a] ?? a)}</option>
            ))}
          </select>
        </div>
      </div>

      <p className="text-xs text-slate-400">
        {isLoading ? "Cargando..." : `${filtered.length} registro${filtered.length !== 1 ? "s" : ""}${logs.length !== filtered.length ? ` (de ${logs.length})` : ""}`}
      </p>

      {/* Tabla */}
      <div className="rounded-xl overflow-hidden bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#001633]">
              <th className="text-left px-4 py-3 text-[11px] font-medium tracking-wider text-white/50">Fecha y hora</th>
              <th className="text-left px-4 py-3 text-[11px] font-medium tracking-wider text-white/50">Usuario</th>
              <th className="text-left px-4 py-3 text-[11px] font-medium tracking-wider text-white/50">Acción</th>
              <th className="text-left px-4 py-3 text-[11px] font-medium tracking-wider text-white/50">Detalle</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i}>
                  <td className="px-4 py-3"><div className="h-4 w-32 bg-slate-200 rounded animate-pulse" /></td>
                  <td className="px-4 py-3"><div className="h-4 w-20 bg-slate-200 rounded animate-pulse" /></td>
                  <td className="px-4 py-3"><div className="h-5 w-28 bg-slate-200 rounded-full animate-pulse" /></td>
                  <td className="px-4 py-3"><div className="h-4 w-48 bg-slate-200 rounded animate-pulse" /></td>
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-16 text-center text-slate-400">
                  Sin registros para este período
                </td>
              </tr>
            ) : (
              filtered.map((log) => {
                const d = parseISO(log.timestamp)
                const fechaLabel = isValid(d) ? format(d, "dd/MM/yyyy HH:mm") : log.timestamp
                const esCritico = ACCION_CRITICA.has(log.accion)
                return (
                  <tr key={log.id} className={`transition-colors ${esCritico ? "bg-red-50/40 hover:bg-red-50/70" : "hover:bg-slate-50/70"}`}>
                    <td className="px-4 py-3 text-slate-400 whitespace-nowrap tabular-nums align-top">{fechaLabel}</td>
                    <td className="px-4 py-3 font-semibold text-slate-900 align-top">{log.displayName}</td>
                    <td className="px-4 py-3 align-top">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${accionBadgeClass(log.accion)}`}>
                        {ACCION_LABEL[log.accion] ?? log.accion}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600 align-top">
                      <p>{log.detalle}</p>
                      {log.cambios && Object.keys(log.cambios).length > 0 && (
                        <div className="mt-1.5 space-y-0.5">
                          {Object.entries(log.cambios).map(([campo, { antes, despues }]) => (
                            <p key={campo} className="text-xs text-slate-400">
                              <span className="font-medium text-slate-500">{campo}:</span>{" "}
                              <span className="line-through text-slate-400">{antes || "—"}</span>
                              {" → "}
                              <span className="text-slate-600">{despues || "—"}</span>
                            </p>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
