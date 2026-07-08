"use client"

import { useState, useEffect, useRef } from "react"
import { format, isToday } from "date-fns"
import { es } from "date-fns/locale"
import { ChevronLeft, ChevronRight, Plus, Search, X, Flag, CheckCircle2, Loader2, Printer, Clock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Printable } from "@/components/printable"
import { printScoped } from "@/lib/print"
import { Turno, TurnoEstado } from "@/types"

const BASE_HOURS = Array.from({ length: 12 }, (_, i) => i + 8) // 8 → 19

const ESTADO_STYLES: Record<TurnoEstado, string> = {
  pendiente: "bg-blue-100 text-blue-800 border-blue-200",
  asistio: "bg-green-100 text-green-800 border-green-200",
  ausente: "bg-red-100 text-red-800 border-red-200",
  cancelado: "bg-gray-100 text-gray-500 border-gray-200 line-through",
}

function chipStyle(turno: Turno): string {
  if (turno.estado === "ausente" && turno.justificado === true)
    return "bg-orange-100 text-orange-800 border-orange-200"
  return ESTADO_STYLES[turno.estado]
}

const ESTADO_LABELS: Record<TurnoEstado, string> = {
  pendiente: "Pendiente",
  asistio: "Asistió",
  ausente: "Ausente",
  cancelado: "Cancelado",
}

const FILTER_CHIPS: { value: TurnoEstado | null; label: string }[] = [
  { value: null, label: "Todos" },
  { value: "pendiente", label: "Pendiente" },
  { value: "asistio", label: "Asistió" },
  { value: "ausente", label: "Ausente" },
  { value: "cancelado", label: "Cancelado" },
]

function filterChipStyle(value: TurnoEstado | null, active: boolean): string {
  if (!active)
    return "border border-gray-200 text-gray-500 bg-white hover:border-gray-300 hover:text-gray-700"
  if (value === null) return "bg-[#001633] text-white border-[#001633]"
  if (value === "pendiente") return "bg-blue-100 text-blue-800 border-blue-300"
  if (value === "asistio") return "bg-green-100 text-green-800 border-green-300"
  if (value === "ausente") return "bg-red-100 text-red-800 border-red-300"
  return "bg-gray-200 text-gray-700 border-gray-300"
}

interface AgendaDiaProps {
  fecha: Date
  turnos: Turno[]
  feriado?: string
  onNuevoTurno: (hora: string) => void
  onEditarTurno: (turno: Turno) => void
  onPrevDay: () => void
  onNextDay: () => void
  onConfirmarAsistencia?: (turno: Turno, fecha: string) => Promise<void>
}

export function AgendaDia({ fecha, turnos, feriado, onNuevoTurno, onEditarTurno, onPrevDay, onNextDay, onConfirmarAsistencia }: AgendaDiaProps) {
  const [filterEstado, setFilterEstado] = useState<TurnoEstado | null>(null)
  const [searchName, setSearchName] = useState("")
  const [confirmingIds, setConfirmingIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    setFilterEstado(null)
    setSearchName("")
    setConfirmingIds(new Set())
  }, [fecha])

  const hasFilter = filterEstado !== null || searchName.trim() !== ""

  // Día futuro: no se puede confirmar asistencia (todavía no pasó)
  const esFuturo = (() => {
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0)
    const f = new Date(fecha); f.setHours(0, 0, 0, 0)
    return f > hoy
  })()

  const filteredTurnos = turnos.filter((t) => {
    const matchesEstado = filterEstado === null || t.estado === filterEstado
    // Busca en ambos órdenes: la agenda muestra "apellido nombre" pero cada una
    // tipea como le sale ("juan perez" o "perez juan" encuentran lo mismo)
    const q = searchName.trim().toLowerCase()
    const matchesName =
      q === "" ||
      `${t.nombre} ${t.apellido}`.toLowerCase().includes(q) ||
      `${t.apellido} ${t.nombre}`.toLowerCase().includes(q)
    return matchesEstado && matchesName
  })

  const extraHours = turnos.map((t) => parseInt(t.hora.split(":")[0], 10)).filter((h) => h < 8 || h > 19)
  const allHours = [...new Set([...BASE_HOURS, ...extraHours])].sort((a, b) => a - b)

  // When filtering: show only hours with matching turnos (no empty rows)
  const HOURS = hasFilter
    ? [...new Set(filteredTurnos.map((t) => parseInt(t.hora.split(":")[0], 10)))].sort((a, b) => a - b)
    : allHours

  const turnosPorHora = HOURS.reduce<Record<number, Turno[]>>((acc, h) => {
    acc[h] = filteredTurnos.filter((t) => parseInt(t.hora.split(":")[0], 10) === h)
    return acc
  }, {})

  const firstFreeHour = allHours.find(
    (h) => turnos.filter((t) => parseInt(t.hora.split(":")[0], 10) === h).length === 0
  )
  const defaultNuevoHora =
    firstFreeHour !== undefined ? `${String(firstFreeHour).padStart(2, "0")}:00` : "09:00"

  // Salto a la hora actual (solo mirando el día de hoy). Con 40+ turnos, la tarde
  // queda a varias pantallas de scroll: al abrir la agenda se aterriza en el bloque
  // de la hora corriente, y el botón "Ahora" de la barra sticky vuelve de un salto.
  const hourRefs = useRef<Record<number, HTMLDivElement | null>>({})
  const irAHoraActual = (suave: boolean) => {
    const ahora = new Date().getHours()
    // El bloque de la hora actual, o el más cercano hacia atrás (después de las
    // 19 cae en el último; antes de las 8, en el primero = sin scroll).
    const previas = HOURS.filter((h) => h <= ahora)
    const destino = previas.length ? previas[previas.length - 1] : HOURS[0]
    const el = destino !== undefined ? hourRefs.current[destino] : null
    if (!el) return
    const reduceMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
    el.scrollIntoView({ block: "start", behavior: suave && !reduceMotion ? "smooth" : "auto" })
  }

  // Aterrizar al abrir/cambiar a hoy; se re-ancla una vez cuando llegan los turnos
  // (las filas crecen con datos y el destino se corre). Instantáneo, sin animar.
  const hayTurnos = turnos.length > 0
  useEffect(() => {
    if (!isToday(fecha)) return
    irAHoraActual(false)
    // irAHoraActual se re-crea por render; alcanza con re-anclar por fecha/carga
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fecha, hayTurnos])

  const totalAgendados = turnos.length
  const subtitleText = hasFilter
    ? filteredTurnos.length === 0
      ? "Sin resultados"
      : `${filteredTurnos.length} de ${totalAgendados} turno${totalAgendados !== 1 ? "s" : ""}`
    : totalAgendados > 0
    ? `${totalAgendados} turno${totalAgendados !== 1 ? "s" : ""} agendado${totalAgendados !== 1 ? "s" : ""}`
    : "Sin turnos agendados"

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-[#001633] capitalize">
            {format(fecha, "EEEE d 'de' MMMM", { locale: es })}
            {isToday(fecha) && (
              <span className="ml-2 text-xs font-normal text-blue-500 bg-blue-50 px-2 py-0.5 rounded-full">
                Hoy
              </span>
            )}
          </h3>
          <p className="text-xs text-gray-400 mt-0.5">{subtitleText}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 border-[#001633] text-[#001633] hover:bg-[#001633] hover:text-white text-xs"
            onClick={() => onNuevoTurno(defaultNuevoHora)}
          >
            <Plus className="h-3.5 w-3.5" />
            Nuevo turno
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 border-gray-200 text-gray-600 hover:bg-gray-50 text-xs"
            onClick={printScoped}
            title="Imprimir la agenda del día"
          >
            <Printer className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Imprimir</span>
          </Button>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 border-gray-200 text-gray-500 hover:bg-gray-50"
              onClick={onPrevDay}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 border-gray-200 text-gray-500 hover:bg-gray-50"
              onClick={onNextDay}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Holiday banner */}
      {feriado && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
          <Flag className="h-4 w-4 shrink-0 text-amber-500" />
          <span>Feriado nacional — <strong>{feriado}</strong></span>
        </div>
      )}

      {/* Filters — sticky: con la agenda larga, los controles siguen a mano al
          scrollear a los horarios de la tarde (pedido de las asistentes). Fondo
          sólido a propósito: un backdrop-blur acá repinta en cada frame de
          scroll y con un fondo casi opaco no se percibe. */}
      {turnos.length > 0 && (
        <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 bg-slate-50 py-2">
          {FILTER_CHIPS.map((chip) => {
            const isActive = chip.value === null ? filterEstado === null : filterEstado === chip.value
            return (
              <button
                key={String(chip.value)}
                onClick={() =>
                  setFilterEstado(isActive && chip.value !== null ? null : chip.value)
                }
                className={[
                  "text-xs px-2.5 py-1 rounded-full border transition-colors",
                  filterChipStyle(chip.value, isActive),
                ].join(" ")}
              >
                {chip.label}
                {chip.value !== null && (
                  <span className="ml-1 opacity-60">
                    ({turnos.filter((t) => t.estado === chip.value).length})
                  </span>
                )}
              </button>
            )
          })}

          {/* Ir a la hora actual (solo hoy) */}
          {isToday(fecha) && (
            <button
              onClick={() => irAHoraActual(true)}
              title="Ir a la hora actual"
              className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-500 transition-colors hover:border-gray-300 hover:text-gray-700"
            >
              <Clock className="h-3 w-3" />
              Ahora
            </button>
          )}

          {/* Name search */}
          <div className="relative ml-auto">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400 pointer-events-none" />
            <input
              type="text"
              value={searchName}
              onChange={(e) => setSearchName(e.target.value)}
              placeholder="Buscar paciente..."
              className="text-xs pl-6 pr-6 py-1 rounded-full border border-gray-200 bg-white focus:outline-none focus:border-[#001633] w-36 sm:w-44 transition-colors"
            />
            {searchName && (
              <button
                onClick={() => setSearchName("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* Clear all */}
          {hasFilter && (
            <button
              onClick={() => {
                setFilterEstado(null)
                setSearchName("")
              }}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              Limpiar
            </button>
          )}
        </div>
      )}

      {/* Timeline */}
      <div className="border border-gray-200 rounded-lg overflow-hidden divide-y divide-gray-100">
        {hasFilter && filteredTurnos.length === 0 && (
          <div className="py-10 text-center text-sm text-gray-400">
            Sin turnos que coincidan con el filtro
          </div>
        )}

        {HOURS.map((hour) => {
          const hourLabel = `${String(hour).padStart(2, "0")}:00`
          const horasTurnos = turnosPorHora[hour]
          const libre = horasTurnos.length === 0

          return (
            <div
              key={hour}
              ref={(el) => { hourRefs.current[hour] = el }}
              className={[
                // scroll-mt compensa la barra sticky al saltar a una hora
                "flex min-h-[52px] scroll-mt-16",
                libre && !hasFilter ? "hover:bg-gray-50 group cursor-pointer" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={libre && !hasFilter ? () => onNuevoTurno(hourLabel) : undefined}
            >
              <div
                className={[
                  "w-16 shrink-0 flex items-start justify-center pt-3.5 text-xs font-mono border-r border-gray-100",
                  libre ? "text-gray-300" : "text-gray-500 font-medium",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {hourLabel}
              </div>

              <div className="flex-1 px-3 py-2 flex flex-col gap-1.5 justify-center">
                {libre && !hasFilter ? (
                  <span className="text-xs text-gray-300 group-hover:text-gray-400 flex items-center gap-1 transition-colors">
                    <Plus className="h-3 w-3" />
                    Agregar turno
                  </span>
                ) : (
                  horasTurnos.map((turno) => {
                    const isConfirming = confirmingIds.has(turno.id)
                    const canQuickConfirm = turno.estado === "pendiente" && !!turno.patientId && !!onConfirmarAsistencia && !esFuturo
                    return (
                      <div key={turno.id} className="flex items-stretch gap-1.5 w-full max-w-sm">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            onEditarTurno(turno)
                          }}
                          className={[
                            "text-left text-sm px-3 py-1.5 rounded border flex-1",
                            "hover:opacity-75 transition-opacity",
                            chipStyle(turno),
                          ].join(" ")}
                        >
                          <div className="flex items-center justify-between gap-4">
                            <span className="font-medium">
                              {/* Apellido primero: las asistentes escanean la agenda por apellido */}
                              {turno.hora} — {turno.apellido} {turno.nombre}
                            </span>
                            <span className="text-xs opacity-70 shrink-0">
                              {ESTADO_LABELS[turno.estado]}
                            </span>
                          </div>
                          {turno.notas && (
                            <p className="text-xs opacity-60 mt-0.5 truncate">{turno.notas}</p>
                          )}
                        </button>

                        {canQuickConfirm && (
                          <button
                            type="button"
                            title="Confirmar asistencia"
                            disabled={isConfirming}
                            onClick={async (e) => {
                              e.stopPropagation()
                              setConfirmingIds((prev) => new Set([...prev, turno.id]))
                              try {
                                await onConfirmarAsistencia!(turno, format(fecha, "yyyy-MM-dd"))
                              } catch {
                                // error handled by parent
                              } finally {
                                setConfirmingIds((prev) => {
                                  const s = new Set(prev)
                                  s.delete(turno.id)
                                  return s
                                })
                              }
                            }}
                            className="shrink-0 flex items-center gap-1 px-2.5 rounded border text-xs font-medium bg-green-50 border-green-300 text-green-700 hover:bg-green-100 disabled:opacity-50 transition-colors"
                          >
                            {isConfirming
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <CheckCircle2 className="h-3.5 w-3.5" />
                            }
                            <span className="hidden sm:inline ml-0.5">Confirmar</span>
                          </button>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Región imprimible (oculta en pantalla): tabla limpia de la agenda del día.
          La dispara el botón "Imprimir" vía printScoped(). */}
      <Printable>
        <div className="p-2 text-black">
          <div className="mb-4 border-b border-black pb-2">
            <h1 className="text-lg font-bold">Kinesiología Integral</h1>
            <p className="text-sm">Lic. Ana Patricia Tullio · 02320-659087</p>
            <p className="mt-2 text-base font-semibold capitalize">
              Agenda del {format(fecha, "EEEE d 'de' MMMM 'de' yyyy", { locale: es })}
            </p>
            <p className="text-xs">
              {totalAgendados} turno{totalAgendados !== 1 ? "s" : ""} agendado{totalAgendados !== 1 ? "s" : ""}
              {feriado ? ` · Feriado: ${feriado}` : ""}
            </p>
          </div>
          {totalAgendados === 0 ? (
            <p className="text-sm">Sin turnos agendados.</p>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b-2 border-black text-left">
                  <th className="py-1 pr-3 w-16">Hora</th>
                  <th className="py-1 pr-3">Paciente</th>
                  <th className="py-1 pr-3 w-28">Estado</th>
                  <th className="py-1">Notas</th>
                </tr>
              </thead>
              <tbody>
                {[...turnos]
                  .sort((a, b) => a.hora.localeCompare(b.hora))
                  .map((t) => (
                    <tr key={t.id} className="border-b border-gray-400 align-top">
                      <td className="py-1 pr-3 font-mono">{t.hora}</td>
                      <td className="py-1 pr-3">{t.apellido} {t.nombre}</td>
                      <td className="py-1 pr-3">
                        {ESTADO_LABELS[t.estado]}
                        {t.estado === "ausente" && t.justificado ? " (just.)" : ""}
                      </td>
                      <td className="py-1">{t.notas ?? ""}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </div>
      </Printable>
    </div>
  )
}
