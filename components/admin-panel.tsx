"use client"

import { useEffect, useState } from "react"
import { useCachedMonth } from "@/lib/monthly-cache"
import { fetchOpinionesMes, fetchLogsMes, type Opinion, type LogEntry } from "@/lib/helpers"
import { format, parseISO, isValid, addMonths, subMonths } from "date-fns"
import { formatInTimeZone } from "date-fns-tz"
import { es } from "date-fns/locale"
import { ChevronLeft, ChevronRight, ChevronDown, Shield, Star, Search, Inbox, CalendarDays, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AdminDatos } from "@/components/admin-datos"
import { AdminDuplicados } from "@/components/admin-duplicados"

const TZ = "America/Argentina/Buenos_Aires"

function Estrellas({ rating, size = "h-4 w-4" }: { rating: number; size?: string }) {
  return (
    <span className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={`${size} ${n <= rating ? "fill-amber-400 text-amber-400" : "text-slate-200"}`}
        />
      ))}
    </span>
  )
}

const ACCION_LABEL: Record<string, string> = {
  crear_paciente: "Crear paciente",
  editar_paciente: "Editar paciente",
  eliminar_paciente: "Eliminar paciente",
  fusionar_pacientes: "Fusionar pacientes",
  deshacer_fusion: "Deshacer fusión",
  confirmar_asistencia: "Confirmar asistencia",
  deshacer_asistencia: "Deshacer asistencia",
  crear_turno: "Crear turno",
  editar_turno: "Editar turno",
  reprogramar_turno: "Reprogramar turno",
  eliminar_turno: "Eliminar turno",
  eliminar_todos_turnos: "Eliminar turnos próximos",
  deshacer_eliminar_turnos: "Deshacer eliminación de turnos",
  editar_libro_diario: "Editar libro diario",
  eliminar_entrada_libro: "Eliminar entrada del libro",
  login: "Inicio de sesión",
  logout: "Cierre de sesión",
}

const ACCION_CRITICA = new Set(["eliminar_paciente", "eliminar_todos_turnos"])

function accionTheme(accion: string): { badge: string; dot: string } {
  if (accion === "login" || accion === "logout")
    return { badge: "bg-sky-50 text-sky-700 border-sky-200", dot: "bg-sky-500" }
  if (accion.startsWith("deshacer"))
    return { badge: "bg-amber-50 text-amber-700 border-amber-200", dot: "bg-amber-500" }
  if (accion === "reprogramar_turno")
    return { badge: "bg-teal-50 text-teal-700 border-teal-200", dot: "bg-teal-500" }
  if (accion.startsWith("crear"))
    return { badge: "bg-green-50 text-green-700 border-green-200", dot: "bg-green-500" }
  if (accion.startsWith("editar"))
    return { badge: "bg-blue-50 text-blue-700 border-blue-200", dot: "bg-blue-500" }
  if (accion.startsWith("eliminar"))
    return { badge: "bg-red-50 text-red-700 border-red-200", dot: "bg-red-500" }
  if (accion === "confirmar_asistencia")
    return { badge: "bg-violet-50 text-violet-700 border-violet-200", dot: "bg-violet-500" }
  if (accion === "fusionar_pacientes")
    return { badge: "bg-indigo-50 text-indigo-700 border-indigo-200", dot: "bg-indigo-500" }
  return { badge: "bg-gray-50 text-gray-600 border-gray-200", dot: "bg-gray-400" }
}

function AccionBadge({ accion }: { accion: string }) {
  const { badge, dot } = accionTheme(accion)
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] px-2.5 py-1 rounded-full border font-medium ${badge}`}>
      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dot}`} />
      {ACCION_LABEL[accion] ?? accion}
    </span>
  )
}

function CambiosList({ cambios }: { cambios?: LogEntry["cambios"] }) {
  if (!cambios || Object.keys(cambios).length === 0) return null
  return (
    <div className="mt-2 space-y-1 border-l-2 border-slate-200 pl-3">
      {Object.entries(cambios).map(([campo, { antes, despues }]) => (
        <p key={campo} className="text-xs leading-relaxed break-words">
          <span className="font-medium text-slate-500">{campo}:</span>{" "}
          <span className="line-through text-slate-400 decoration-slate-300">{antes || "—"}</span>
          <span className="mx-1.5 text-slate-300">→</span>
          <span className="text-slate-700">{despues || "—"}</span>
        </p>
      ))}
    </div>
  )
}

export function AdminPanel() {
  const [currentMonth, setCurrentMonth] = useState(() => new Date())
  const [filterUser, setFilterUser] = useState("todos")
  const [filterAccion, setFilterAccion] = useState("todas")
  const [searchPaciente, setSearchPaciente] = useState("")
  const [vista, setVista] = useState<"registro" | "opiniones" | "datos" | "duplicados">("registro")
  const [diaIndex, setDiaIndex] = useState(0) // paginación por día del registro (0 = día más reciente)
  const [usuariosOpen, setUsuariosOpen] = useState(false) // resumen por usuario colapsable

  const mesKey = format(currentMonth, "yyyy-MM")
  // El mes actual puede crecer (logs/opiniones nuevas) → revalidar; los pasados son inmutables
  const esMesActual = mesKey === format(new Date(), "yyyy-MM")

  // Logs del mes (caché de sesión; revalida solo el mes actual). Filtros en memoria.
  // Misma key que la pestaña Datos (pacientes nuevos) → caché compartida.
  const { data: logs, isLoading } = useCachedMonth<LogEntry[]>(
    `logs/${mesKey}`,
    () => fetchLogsMes(mesKey),
    { revalidate: esMesActual, fallback: [] },
  )

  // Opiniones: lazy (solo cuando la vista está activa) + caché por mes (compartida con Datos)
  const { data: opiniones, isLoading: isLoadingOpiniones } = useCachedMonth<Opinion[]>(
    `opiniones/${mesKey}`,
    () => fetchOpinionesMes(mesKey),
    { enabled: vista === "opiniones", revalidate: esMesActual, fallback: [] },
  )

  // Reset de filtros al cambiar de mes (antes vivía dentro del fetch de logs)
  useEffect(() => {
    setFilterUser("todos")
    setFilterAccion("todas")
    setSearchPaciente("")
  }, [mesKey])

  // Volver al día más reciente cuando cambia el universo de logs (mes o filtros)
  useEffect(() => {
    setDiaIndex(0)
  }, [mesKey, filterUser, filterAccion, searchPaciente])

  const promedio = opiniones.length
    ? opiniones.reduce((sum, o) => sum + o.rating, 0) / opiniones.length
    : 0
  const distribucion = [5, 4, 3, 2, 1].map((n) => ({
    estrellas: n,
    count: opiniones.filter((o) => o.rating === n).length,
  }))
  const porKine = Array.from(
    opiniones.reduce((map, o) => {
      if (!o.atendidoPor) return map
      const cur = map.get(o.atendidoPor) ?? { sum: 0, count: 0 }
      map.set(o.atendidoPor, { sum: cur.sum + o.rating, count: cur.count + 1 })
      return map
    }, new Map<string, { sum: number; count: number }>())
  ).sort((a, b) => b[1].count - a[1].count)

  // Identidad por email (único e inmutable); el displayName puede cambiar o colapsar
  // entre usuarios sin mapear. Logs viejos sin email caen al displayName como clave.
  const userKey = (l: LogEntry) => l.email || l.displayName

  // email → displayName más reciente (logs ya ordenados desc por timestamp)
  const usuariosMap = new Map<string, string>()
  for (const l of logs) {
    const key = userKey(l)
    if (!usuariosMap.has(key)) usuariosMap.set(key, l.displayName)
  }
  const usuarios = Array.from(usuariosMap.entries()) // [email, nombre]

  const acciones = ["todas", ...Array.from(new Set(logs.map((l) => l.accion)))]

  const filtered = logs.filter((l) => {
    if (filterUser !== "todos" && userKey(l) !== filterUser) return false
    if (filterAccion !== "todas" && l.accion !== filterAccion) return false
    if (searchPaciente.trim()) {
      const q = searchPaciente.toLowerCase()
      if (!l.detalle.toLowerCase().includes(q)) return false
    }
    return true
  })

  // Agrupación por día (hora Argentina, igual criterio que el bucket de mes).
  // `filtered` viene desc por timestamp, así que los días quedan del más reciente al más viejo.
  const dias: { dayKey: string; logs: LogEntry[] }[] = []
  {
    const map = new Map<string, LogEntry[]>()
    for (const l of filtered) {
      const d = parseISO(l.timestamp)
      const dayKey = isValid(d) ? formatInTimeZone(d, TZ, "yyyy-MM-dd") : "sin-fecha"
      const arr = map.get(dayKey)
      if (arr) {
        arr.push(l)
      } else {
        const nuevo = [l]
        map.set(dayKey, nuevo)
        dias.push({ dayKey, logs: nuevo })
      }
    }
  }
  const safeDiaIndex = dias.length ? Math.min(diaIndex, dias.length - 1) : 0
  const diaActual = dias[safeDiaIndex]
  const diaLabel = diaActual
    ? diaActual.dayKey === "sin-fecha"
      ? "Sin fecha"
      : format(parseISO(diaActual.dayKey), "EEEE d 'de' MMMM", { locale: es })
    : ""

  // Resumen por usuario (sobre logs sin filtrar del mes)
  const resumenUsuarios = Array.from(
    logs.reduce((map, l) => {
      const key = userKey(l)
      map.set(key, (map.get(key) ?? 0) + 1)
      return map
    }, new Map<string, number>())
  )
    .map(([key, count]) => ({ key, nombre: usuariosMap.get(key) ?? key, count }))
    .sort((a, b) => b.count - a.count)

  const mesLabel = format(currentMonth, "MMMM yyyy", { locale: es })

  const selectClass =
    "h-9 sm:h-8 text-sm border border-slate-200 rounded-lg px-2 bg-white text-slate-700 focus:outline-none focus:border-[#001633] transition-colors"

  return (
    <div className="space-y-5">
      {/* Encabezado */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-[#001633] flex items-center justify-center shrink-0">
            <Shield className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-[#001633] leading-tight">Panel de administración</h2>
            <p className="text-xs text-slate-400">
              {vista === "registro"
                ? "Registro de actividad del equipo"
                : vista === "opiniones"
                ? "Opiniones de pacientes"
                : "Métricas del consultorio"}
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
          {/* Toggle registro / opiniones / datos — segmentado full-width en mobile */}
          <div className="flex w-full sm:inline-flex sm:w-auto rounded-lg bg-slate-100 p-1">
            {([
              ["registro", "Registro de actividad", "Registro"],
              ["opiniones", "Opiniones", "Opiniones"],
              ["datos", "Datos", "Datos"],
              ["duplicados", "Duplicados", "Duplic."],
            ] as const).map(([value, label, short]) => (
              <button
                key={value}
                onClick={() => setVista(value)}
                className={`flex-1 sm:flex-none px-3 sm:px-3.5 py-1.5 text-sm rounded-md transition-all whitespace-nowrap ${
                  vista === value
                    ? "bg-white text-[#001633] font-semibold shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                <span className="sm:hidden">{short}</span>
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </div>

          {/* Navegación de mes */}
          <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-slate-500 hover:text-[#001633]"
              onClick={() => setCurrentMonth((m) => subMonths(m, 1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium text-slate-700 capitalize w-32 text-center select-none">
              {mesLabel}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-slate-500 hover:text-[#001633]"
              onClick={() => setCurrentMonth((m) => addMonths(m, 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {vista === "duplicados" ? (
        <AdminDuplicados />
      ) : vista === "datos" ? (
        <AdminDatos currentMonth={currentMonth} />
      ) : vista === "opiniones" ? (
        <>
          {isLoadingOpiniones ? (
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm px-4 py-16 text-center text-sm text-slate-400">
              Cargando...
            </div>
          ) : opiniones.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm px-4 py-16 text-center">
              <Inbox className="h-8 w-8 text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-400">Sin opiniones para este período</p>
            </div>
          ) : (
            <>
              {/* Resumen */}
              <div className="flex flex-wrap gap-3">
                <div className="bg-white rounded-2xl border border-slate-200 px-4 py-3 shadow-sm">
                  <p className="text-2xl font-semibold text-slate-800 flex items-center gap-2">
                    {promedio.toFixed(1)}
                    <Star className="h-5 w-5 fill-amber-400 text-amber-400" />
                  </p>
                  <p className="text-xs text-slate-400">{opiniones.length} opinión{opiniones.length !== 1 ? "es" : ""} este mes</p>
                </div>
                <div className="bg-white rounded-2xl border border-slate-200 px-4 py-3 shadow-sm">
                  {distribucion.map(({ estrellas, count }) => (
                    <div key={estrellas} className="flex items-center gap-2 text-xs">
                      <span className="w-3 text-slate-500 tabular-nums">{estrellas}</span>
                      <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                      <div className="w-28 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-amber-400 rounded-full"
                          style={{ width: `${opiniones.length ? (count / opiniones.length) * 100 : 0}%` }}
                        />
                      </div>
                      <span className="text-slate-400 tabular-nums">{count}</span>
                    </div>
                  ))}
                </div>
                {porKine.map(([kine, { sum, count }]) => (
                  <div key={kine} className="bg-white rounded-2xl border border-slate-200 px-4 py-3 shadow-sm">
                    <p className="text-sm font-semibold text-slate-800">{kine}</p>
                    <p className="text-xs text-slate-400 flex items-center gap-1">
                      {(sum / count).toFixed(1)}
                      <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                      · {count} opinión{count !== 1 ? "es" : ""}
                    </p>
                  </div>
                ))}
              </div>

              {/* Listado */}
              <div className="rounded-2xl overflow-hidden bg-white border border-slate-200 shadow-sm divide-y divide-slate-100">
                {opiniones.map((o) => {
                  const d = parseISO(o.fecha)
                  return (
                    <div key={o.id} className="px-4 py-3 hover:bg-slate-50/60 transition-colors">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <Estrellas rating={o.rating} />
                        <span className="text-sm font-medium text-slate-800">{o.nombre}</span>
                        {o.atendidoPor && (
                          <span className="text-[11px] px-2 py-0.5 rounded-full border bg-blue-50 text-blue-700 border-blue-200">
                            Atendió: {o.atendidoPor}
                          </span>
                        )}
                        <span className="text-xs text-slate-400 ml-auto tabular-nums">
                          {isValid(d) ? format(d, "dd/MM/yyyy HH:mm") : o.fecha}
                        </span>
                      </div>
                      {o.comentario && (
                        <p className="text-sm text-slate-600 mt-1.5">{o.comentario}</p>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </>
      ) : (
        <>
          {/* Resumen del mes por usuario — colapsable */}
          {!isLoading && resumenUsuarios.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setUsuariosOpen((o) => !o)}
                aria-expanded={usuariosOpen}
                className="w-full flex items-center gap-2 px-4 py-2.5 rounded-2xl border border-slate-200 bg-white shadow-sm hover:bg-slate-50/70 transition-colors"
              >
                <Users className="h-4 w-4 text-[#001633] shrink-0" />
                <span className="text-sm font-semibold text-slate-700">Actividad por usuario</span>
                <span className="text-xs text-slate-400 tabular-nums">
                  {resumenUsuarios.length} usuario{resumenUsuarios.length !== 1 ? "s" : ""}
                </span>
                <div className="ml-auto flex items-center gap-2">
                  {!usuariosOpen && (
                    <div className="hidden sm:flex -space-x-2">
                      {resumenUsuarios.slice(0, 5).map(({ key, nombre }) => (
                        <div
                          key={key}
                          className="h-6 w-6 rounded-full bg-[#001633] border-2 border-white flex items-center justify-center text-white text-[10px] font-semibold"
                        >
                          {nombre.charAt(0).toUpperCase()}
                        </div>
                      ))}
                      {resumenUsuarios.length > 5 && (
                        <div className="h-6 w-6 rounded-full bg-slate-200 border-2 border-white flex items-center justify-center text-slate-500 text-[9px] font-semibold">
                          +{resumenUsuarios.length - 5}
                        </div>
                      )}
                    </div>
                  )}
                  <ChevronDown className={`h-4 w-4 text-slate-400 shrink-0 transition-transform duration-200 ${usuariosOpen ? "rotate-180" : ""}`} />
                </div>
              </button>

              {usuariosOpen && (
                <div className="flex flex-wrap gap-3 mt-3">
                  {resumenUsuarios.map(({ key, nombre, count }) => (
                    <div key={key} title={key} className="bg-white rounded-2xl border border-slate-200 px-4 py-3 shadow-sm flex items-center gap-3">
                      <div className="h-9 w-9 rounded-full bg-[#001633] flex items-center justify-center text-white text-sm font-semibold shrink-0">
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
            </div>
          )}

          {/* Tabla con barra de filtros */}
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 px-3 sm:px-4 py-3 border-b border-slate-100 bg-slate-50/50">
              <div className="relative w-full sm:w-48">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
                <Input
                  placeholder="Buscar paciente..."
                  value={searchPaciente}
                  onChange={(e) => setSearchPaciente(e.target.value)}
                  className="h-9 sm:h-8 pl-8 text-sm w-full bg-white border-slate-200 focus:border-[#001633] rounded-lg"
                />
              </div>
              <select
                value={filterUser}
                onChange={(e) => setFilterUser(e.target.value)}
                className={`${selectClass} flex-1 min-w-0 sm:flex-none`}
              >
                <option value="todos">Todos los usuarios</option>
                {usuarios.map(([email, nombre]) => (
                  <option key={email} value={email}>{nombre}</option>
                ))}
              </select>
              <select
                value={filterAccion}
                onChange={(e) => setFilterAccion(e.target.value)}
                className={`${selectClass} flex-1 min-w-0 sm:flex-none`}
              >
                {acciones.map((a) => (
                  <option key={a} value={a}>{a === "todas" ? "Todas las acciones" : (ACCION_LABEL[a] ?? a)}</option>
                ))}
              </select>
              <span className="w-full text-right sm:w-auto sm:ml-auto text-xs text-slate-400 tabular-nums">
                {isLoading
                  ? "Cargando..."
                  : `${filtered.length} registro${filtered.length !== 1 ? "s" : ""}${logs.length !== filtered.length ? ` (de ${logs.length})` : ""}`}
              </span>
            </div>

            {isLoading ? (
              <div className="divide-y divide-slate-100">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="px-4 py-3.5 flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-slate-200 animate-pulse shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 w-32 bg-slate-200 rounded animate-pulse" />
                      <div className="h-3 w-48 max-w-full bg-slate-200 rounded animate-pulse" />
                    </div>
                  </div>
                ))}
              </div>
            ) : dias.length === 0 ? (
              <div className="px-4 py-16 text-center">
                <Inbox className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                <p className="text-sm text-slate-400">Sin registros para este período</p>
              </div>
            ) : (
              <>
                {/* Navegador por día */}
                <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-slate-100 bg-slate-50/30">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-slate-500 hover:text-[#001633] disabled:opacity-30"
                    onClick={() => setDiaIndex(safeDiaIndex + 1)}
                    disabled={safeDiaIndex >= dias.length - 1}
                    title="Día anterior"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <div className="flex items-center gap-2 min-w-0 text-center">
                    <CalendarDays className="h-4 w-4 text-[#001633] shrink-0 hidden sm:block" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-800 capitalize truncate leading-tight">{diaLabel}</p>
                      <p className="text-[11px] text-slate-400 tabular-nums">
                        {diaActual.logs.length} registro{diaActual.logs.length !== 1 ? "s" : ""} · día {safeDiaIndex + 1} de {dias.length}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-slate-500 hover:text-[#001633] disabled:opacity-30"
                    onClick={() => setDiaIndex(safeDiaIndex - 1)}
                    disabled={safeDiaIndex <= 0}
                    title="Día siguiente"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>

                {/* Mobile: cards */}
                <div className="sm:hidden divide-y divide-slate-100">
                  {diaActual.logs.map((log) => {
                    const d = parseISO(log.timestamp)
                    const esCritico = ACCION_CRITICA.has(log.accion)
                    return (
                      <div key={log.id} className={`px-4 py-3 ${esCritico ? "bg-red-50/40" : ""}`}>
                        <div className="flex items-center gap-2 mb-2">
                          <div className="h-7 w-7 rounded-full bg-[#001633]/90 flex items-center justify-center text-white text-[11px] font-semibold shrink-0">
                            {log.displayName.charAt(0).toUpperCase()}
                          </div>
                          <span className="font-medium text-slate-800 text-sm truncate flex-1 min-w-0">{log.displayName}</span>
                          <span className="text-[11px] text-slate-400 tabular-nums shrink-0">
                            {isValid(d) ? `${formatInTimeZone(d, TZ, "HH:mm")} hs` : log.timestamp}
                          </span>
                        </div>
                        <AccionBadge accion={log.accion} />
                        <p className="text-sm text-slate-600 leading-relaxed mt-1.5 break-words">{log.detalle}</p>
                        <CambiosList cambios={log.cambios} />
                      </div>
                    )
                  })}
                </div>

                {/* Desktop: tabla */}
                <div className="hidden sm:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-[#001633]">
                        {/* w-px + nowrap: las tres primeras columnas se ajustan a su contenido
                            y todo el ancho sobrante va a Detalle */}
                        <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-white/60 w-px whitespace-nowrap">Hora</th>
                        <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-white/60 w-px whitespace-nowrap">Usuario</th>
                        <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-white/60 w-px whitespace-nowrap">Acción</th>
                        <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-white/60">Detalle</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {diaActual.logs.map((log) => {
                        const d = parseISO(log.timestamp)
                        const esCritico = ACCION_CRITICA.has(log.accion)
                        return (
                          <tr key={log.id} className={`transition-colors ${esCritico ? "bg-red-50/40 hover:bg-red-50/70" : "hover:bg-slate-50/70"}`}>
                            <td className="px-4 py-3.5 whitespace-nowrap align-top">
                              {isValid(d) ? (
                                <p className="text-slate-600 tabular-nums leading-tight">{formatInTimeZone(d, TZ, "HH:mm")} <span className="text-xs text-slate-400">hs</span></p>
                              ) : (
                                <p className="text-slate-400 tabular-nums text-xs">{log.timestamp}</p>
                              )}
                            </td>
                            <td className="px-4 py-3.5 whitespace-nowrap align-top">
                              <div className="flex items-center gap-2" title={log.email}>
                                <div className="h-7 w-7 rounded-full bg-[#001633]/90 flex items-center justify-center text-white text-[11px] font-semibold shrink-0">
                                  {log.displayName.charAt(0).toUpperCase()}
                                </div>
                                <span className="font-medium text-slate-800">{log.displayName}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3.5 whitespace-nowrap align-top">
                              <AccionBadge accion={log.accion} />
                            </td>
                            <td className="px-4 py-3.5 text-slate-600 align-top">
                              <p className="leading-relaxed">{log.detalle}</p>
                              <CambiosList cambios={log.cambios} />
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
