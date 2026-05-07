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
import { ChevronLeft, ChevronRight, Plus } from "lucide-react"
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

function chipStyle(turno: Turno): string {
  if (turno.estado === "ausente" && turno.justificado === true)
    return "bg-orange-100 text-orange-800 border-orange-200"
  return ESTADO_STYLES[turno.estado]
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

export function Calendario() {
  const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(new Date()))
  const [turnosPorFecha, setTurnosPorFecha] = useState<Record<string, Turno[]>>({})
  const [isLoading, setIsLoading] = useState(false)

  // Selected day for the agenda view (default: today)
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
  }, [currentMonth, loadTurnos])

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

  const handleChipClick = (e: React.MouseEvent, turno: Turno, dateKey: string) => {
    e.stopPropagation()
    setSelectedTurno(turno)
    setSelectedTurnoFecha(dateKey)
    setEditModalOpen(true)
  }

  const handleTurnoSaved = () => {
    loadTurnos(currentMonth)
  }

  const days = getCalendarDays(currentMonth)
  const weeks: Date[][] = []
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7))
  }

  const totalTurnos = Object.values(turnosPorFecha).flat().length
  const selectedDateKey = format(selectedDate, "yyyy-MM-dd")
  const selectedDateTurnos = turnosPorFecha[selectedDateKey] ?? []

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-semibold text-[#001633] capitalize">
            {format(currentMonth, "MMMM yyyy", { locale: es })}
          </h2>
          {!isLoading && totalTurnos > 0 && (
            <span className="text-sm text-gray-500">
              {totalTurnos} turno{totalTurnos !== 1 ? "s" : ""}
            </span>
          )}
          {isLoading && <span className="text-sm text-gray-400">Cargando...</span>}
        </div>
        <div className="flex items-center gap-2">
          {!isCurrentMonth && (
            <Button
              variant="outline"
              size="sm"
              className="border-[#001633] text-[#001633] hover:bg-[#001633] hover:text-white"
              onClick={() => setCurrentMonth(startOfMonth(new Date()))}
            >
              Hoy
            </Button>
          )}
          <Button
            variant="outline"
            size="icon"
            className="border-[#001633] text-[#001633] hover:bg-[#001633] hover:text-white"
            onClick={() => setCurrentMonth((m) => subMonths(m, 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="border-[#001633] text-[#001633] hover:bg-[#001633] hover:text-white"
            onClick={() => setCurrentMonth((m) => addMonths(m, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Calendar grid */}
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <div className="grid grid-cols-7 bg-[#001633]">
          {DAYS_OF_WEEK.map((d) => (
            <div
              key={d}
              className="py-2 text-center text-xs font-semibold text-white uppercase tracking-wide"
            >
              {d}
            </div>
          ))}
        </div>

        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 divide-x divide-gray-200">
            {week.map((day, di) => {
              const inMonth = isSameMonth(day, currentMonth)
              const today_ = isToday(day)
              const isSelected = isSameDay(day, selectedDate)
              const dateKey = format(day, "yyyy-MM-dd")
              const turnos = turnosPorFecha[dateKey] ?? []

              return (
                <div
                  key={di}
                  onClick={() => handleDayClick(day)}
                  className={[
                    "min-h-[100px] p-1.5 flex flex-col gap-1 border-b border-gray-200",
                    "cursor-pointer group transition-colors",
                    !inMonth ? "bg-gray-50 hover:bg-gray-100" : "hover:bg-slate-50",
                    today_ && "bg-blue-50 hover:bg-blue-100",
                    isSelected && !today_ && "ring-2 ring-inset ring-[#001633]",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={[
                        "text-sm font-medium w-7 h-7 flex items-center justify-center rounded-full",
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
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        openNuevoTurno(day)
                      }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity rounded p-0.5 hover:bg-white/60"
                      title="Agregar turno"
                    >
                      <Plus className="h-3.5 w-3.5 text-gray-500" />
                    </button>
                  </div>

                  {turnos.map((turno) => (
                    <div
                      key={turno.id}
                      onClick={(e) => handleChipClick(e, turno, dateKey)}
                      className={[
                        "text-xs px-1.5 py-0.5 rounded border truncate cursor-pointer hover:opacity-75 transition-opacity",
                        chipStyle(turno),
                      ].join(" ")}
                      title={`${turno.hora} — ${turno.nombre} ${turno.apellido}${turno.notas ? `\n${turno.notas}` : ""}`}
                    >
                      <span className="font-medium">{turno.hora}</span>{" "}
                      {turno.nombre} {turno.apellido}
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500">
        <span className="font-medium">Estados:</span>
        {(Object.entries(ESTADO_STYLES) as [TurnoEstado, string][]).map(([estado, cls]) => (
          <span key={estado} className={`px-2 py-0.5 rounded border ${cls.replace("line-through", "")}`}>
            {estado === "asistio" ? "asistió" : estado}
          </span>
        ))}
        <span className="px-2 py-0.5 rounded border bg-orange-100 text-orange-800 border-orange-200">
          ausente justificado
        </span>
        <span className="text-gray-400 ml-auto">Click en un día para agregar turno</span>
      </div>

      {/* Agenda diaria */}
      <div className="border-t border-gray-200 pt-6">
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
      </div>

      {/* Nuevo turno modal */}
      <NuevoTurnoModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        fecha={selectedDate}
        horaInicial={nuevoTurnoHora}
        onSaved={handleTurnoSaved}
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
