"use client"

import { useState, useEffect, useCallback } from "react"
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  getDay,
  addMonths,
  subMonths,
  addDays,
  subDays,
  isSameMonth,
  isToday,
  isSameDay,
} from "date-fns"
import { es } from "date-fns/locale"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Turno, TurnoEstado } from "@/types"
import { fetchTurnosPorMes } from "@/lib/helpers"
import { NuevoTurnoModal } from "@/components/nuevo-turno-modal"
import { EditarTurnoModal } from "@/components/editar-turno-modal"
import { AgendaDia } from "@/components/agenda-dia"
import { toast } from "sonner"

const DAYS_OF_WEEK = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]

const ESTADO_STYLES: Record<TurnoEstado, string> = {
  pendiente: "bg-blue-100 text-blue-800 border-blue-200",
  asistio: "bg-green-100 text-green-800 border-green-200",
  ausente: "bg-red-100 text-red-800 border-red-200",
  cancelado: "bg-gray-100 text-gray-500 border-gray-200 line-through",
}

function countBadgeStyle(count: number): string {
  if (count <= 15) return "bg-blue-100 text-blue-700"
  if (count <= 25) return "bg-amber-100 text-amber-700"
  return "bg-red-100 text-red-700"
}

function getCalendarDays(month: Date): Date[] {
  const start = startOfMonth(month)
  const end = endOfMonth(month)
  const days = eachDayOfInterval({ start, end })

  let startPad = getDay(start) - 1
  if (startPad < 0) startPad = 6

  const paddedStart: Date[] = []
  for (let i = startPad; i > 0; i--) {
    const d = new Date(start)
    d.setDate(d.getDate() - i)
    paddedStart.push(d)
  }

  const totalCells = Math.ceil((paddedStart.length + days.length) / 7) * 7
  const endPad = totalCells - paddedStart.length - days.length
  const paddedEnd: Date[] = []
  for (let i = 1; i <= endPad; i++) {
    const d = new Date(end)
    d.setDate(d.getDate() + i)
    paddedEnd.push(d)
  }

  return [...paddedStart, ...days, ...paddedEnd]
}

export function Calendario({ refreshTrigger = 0 }: { refreshTrigger?: number }) {
  const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(new Date()))
  const [turnosPorFecha, setTurnosPorFecha] = useState<Record<string, Turno[]>>({})
  const [isLoading, setIsLoading] = useState(false)

  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date())
  const [nuevoTurnoHora, setNuevoTurnoHora] = useState("09:00")
  const [modalOpen, setModalOpen] = useState(false)

  const [selectedTurno, setSelectedTurno] = useState<Turno | null>(null)
  const [selectedTurnoFecha, setSelectedTurnoFecha] = useState("")
  const [editModalOpen, setEditModalOpen] = useState(false)

  const today = new Date()
  const isCurrentMonth =
    currentMonth.getFullYear() === today.getFullYear() &&
    currentMonth.getMonth() === today.getMonth()

  const loadTurnos = useCallback(async (month: Date) => {
    setIsLoading(true)
    try {
      const data = await fetchTurnosPorMes(month.getFullYear(), month.getMonth() + 1)
      setTurnosPorFecha(data)
    } catch {
      toast.error("No se pudieron cargar los turnos")
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadTurnos(currentMonth)
  }, [currentMonth, loadTurnos, refreshTrigger])

  const openNuevoTurno = (day: Date, hora = "09:00") => {
    setSelectedDate(day)
    setNuevoTurnoHora(hora)
    setModalOpen(true)
  }

  const handleDayClick = (day: Date) => {
    setSelectedDate(day)
    if (!isSameMonth(day, currentMonth)) {
      setCurrentMonth(startOfMonth(day))
    }
  }

  const handlePrevDay = () => {
    const prev = subDays(selectedDate, 1)
    setSelectedDate(prev)
    if (!isSameMonth(prev, currentMonth)) {
      setCurrentMonth(startOfMonth(prev))
    }
  }

  const handleNextDay = () => {
    const next = addDays(selectedDate, 1)
    setSelectedDate(next)
    if (!isSameMonth(next, currentMonth)) {
      setCurrentMonth(startOfMonth(next))
    }
  }

  const handleTurnoSaved = () => {
    loadTurnos(currentMonth)
  }

  const days = getCalendarDays(currentMonth)
  const weeks: Date[][] = []
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7))
  }

  const allTurnos = Object.values(turnosPorFecha).flat()
  const totalTurnos = allTurnos.filter((t) => t.estado !== "cancelado").length
  const pendientes = allTurnos.filter((t) => t.estado === "pendiente").length
  const asistieron = allTurnos.filter((t) => t.estado === "asistio").length
  const ausentes = allTurnos.filter((t) => t.estado === "ausente").length
  const selectedDateKey = format(selectedDate, "yyyy-MM-dd")
  const selectedDateTurnos = turnosPorFecha[selectedDateKey] ?? []

  return (
    <div className="flex flex-col lg:flex-row lg:items-start">

      {/* LEFT: compact month navigator */}
      <div className="lg:w-72 xl:w-80 lg:shrink-0 space-y-3 lg:pr-6 lg:sticky lg:top-4 lg:self-start">

        {/* Month header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[#001633] capitalize">
              {format(currentMonth, "MMMM yyyy", { locale: es })}
            </h2>
            {isLoading && (
              <span className="text-xs text-gray-400 mt-0.5 block">Cargando...</span>
            )}
            {!isLoading && !isSameMonth(selectedDate, currentMonth) && (
              <button
                onClick={() => setCurrentMonth(startOfMonth(selectedDate))}
                className="text-[10px] text-blue-600 hover:text-blue-800 mt-0.5 block"
              >
                Agenda en {format(selectedDate, "MMMM", { locale: es })} →
              </button>
            )}
            {!isLoading && totalTurnos > 0 && (
              <div className="flex items-center gap-1 mt-1 flex-wrap">
                {pendientes > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                    {pendientes} pend.
                  </span>
                )}
                {asistieron > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200">
                    {asistieron} asist.
                  </span>
                )}
                {ausentes > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200">
                    {ausentes} aus.
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1">
            {!isCurrentMonth && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs border-[#001633] text-[#001633] hover:bg-[#001633] hover:text-white"
                onClick={() => {
                  setCurrentMonth(startOfMonth(new Date()))
                  setSelectedDate(new Date())
                }}
              >
                Hoy
              </Button>
            )}
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7 border-[#001633] text-[#001633] hover:bg-[#001633] hover:text-white"
              onClick={() => {
                setCurrentMonth((m) => subMonths(m, 1))
                setSelectedDate((d) => subMonths(d, 1))
              }}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7 border-[#001633] text-[#001633] hover:bg-[#001633] hover:text-white"
              onClick={() => {
                setCurrentMonth((m) => addMonths(m, 1))
                setSelectedDate((d) => addMonths(d, 1))
              }}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Compact calendar grid */}
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <div className="grid grid-cols-7 bg-[#001633]">
            {DAYS_OF_WEEK.map((d) => (
              <div
                key={d}
                className="py-1.5 text-center text-[10px] font-semibold text-white uppercase tracking-wide"
              >
                {d}
              </div>
            ))}
          </div>

          {weeks.map((week, wi) => (
            <div key={wi} className="grid grid-cols-7 divide-x divide-gray-100">
              {week.map((day, di) => {
                const inMonth = isSameMonth(day, currentMonth)
                const today_ = isToday(day)
                const isSelected = isSameDay(day, selectedDate)
                const isWeekend = getDay(day) === 0 || getDay(day) === 6
                const dateKey = format(day, "yyyy-MM-dd")
                const turnos = turnosPorFecha[dateKey] ?? []
                const turnosActivos = turnos.filter((t) => t.estado !== "cancelado")

                return (
                  <div
                    key={di}
                    onClick={() => handleDayClick(day)}
                    className={[
                      "h-12 flex flex-col items-center justify-center gap-0.5 border-b border-gray-100",
                      "cursor-pointer transition-colors",
                      !inMonth
                        ? isWeekend ? "bg-gray-100 hover:bg-gray-200" : "bg-gray-50 hover:bg-gray-100"
                        : isWeekend && !today_ ? "bg-gray-50/80 hover:bg-gray-100" : "hover:bg-slate-50",
                      today_ && "bg-blue-50 hover:bg-blue-100",
                      isSelected && "ring-2 ring-inset ring-[#001633]",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <span
                      className={[
                        "text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full",
                        today_
                          ? "bg-[#001633] text-white"
                          : inMonth
                          ? "text-gray-800"
                          : "text-gray-400",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      {format(day, "d")}
                    </span>
                    {turnosActivos.length > 0 && (
                      <span
                        className={`text-[9px] leading-none font-semibold px-1 py-0.5 rounded-full ${
                          today_
                            ? "bg-white text-[#001633] border border-blue-200"
                            : countBadgeStyle(turnosActivos.length)
                        }`}
                      >
                        {turnosActivos.length}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>

        {/* Count legend */}
        <div className="flex items-center gap-3 text-[10px] text-gray-400">
          <span>Turnos:</span>
          <span className="flex items-center gap-1">
            <span className="px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 font-semibold text-[9px]">9</span>
            1–15
          </span>
          <span className="flex items-center gap-1">
            <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold text-[9px]">20</span>
            16–25
          </span>
          <span className="flex items-center gap-1">
            <span className="px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 font-semibold text-[9px]">35</span>
            26+
          </span>
        </div>
      </div>

      {/* RIGHT: day agenda */}
      <div className="flex-1 min-w-0 border-t lg:border-t-0 lg:border-l border-gray-200 pt-5 lg:pt-0 lg:pl-6 mt-4 lg:mt-0">
        <AgendaDia
          fecha={selectedDate}
          turnos={selectedDateTurnos}
          onNuevoTurno={(hora) => openNuevoTurno(selectedDate, hora)}
          onEditarTurno={(turno) => {
            setSelectedTurno(turno)
            setSelectedTurnoFecha(selectedDateKey)
            setEditModalOpen(true)
          }}
          onPrevDay={handlePrevDay}
          onNextDay={handleNextDay}
        />

        {/* Status legend */}
        <div className="flex flex-wrap items-center gap-3 text-xs text-gray-400 mt-5 pt-4 border-t border-gray-100">
          <span className="font-medium text-gray-500">Estados:</span>
          {(Object.entries(ESTADO_STYLES) as [TurnoEstado, string][]).map(([estado, cls]) => (
            <span key={estado} className={`px-2 py-0.5 rounded border ${cls.replace("line-through", "")}`}>
              {estado === "asistio" ? "asistió" : estado}
            </span>
          ))}
          <span className="px-2 py-0.5 rounded border bg-orange-100 text-orange-800 border-orange-200">
            ausente justificado
          </span>
        </div>
      </div>

      {/* Nuevo turno modal */}
      <NuevoTurnoModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        fecha={selectedDate}
        horaInicial={nuevoTurnoHora}
        onSaved={handleTurnoSaved}
        turnosPorFecha={turnosPorFecha}
      />

      {/* Editar turno modal */}
      {selectedTurno && (
        <EditarTurnoModal
          open={editModalOpen}
          onOpenChange={setEditModalOpen}
          fecha={selectedTurnoFecha}
          turno={selectedTurno}
          onSaved={handleTurnoSaved}
        />
      )}
    </div>
  )
}
