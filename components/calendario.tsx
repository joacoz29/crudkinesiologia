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
  isSameMonth,
  isToday,
} from "date-fns"
import { es } from "date-fns/locale"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Turno, TurnoEstado } from "@/types"
import { fetchTurnosPorMes } from "@/lib/helpers"

const DAYS_OF_WEEK = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]

const ESTADO_STYLES: Record<TurnoEstado, string> = {
  pendiente: "bg-blue-100 text-blue-800 border-blue-200",
  asistio: "bg-green-100 text-green-800 border-green-200",
  ausente: "bg-red-100 text-red-800 border-red-200",
  cancelado: "bg-gray-100 text-gray-500 border-gray-200 line-through",
}

function getCalendarDays(month: Date): Date[] {
  const start = startOfMonth(month)
  const end = endOfMonth(month)
  const days = eachDayOfInterval({ start, end })

  // Week starts on Monday (Argentina). getDay: 0=Sun → position 6
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

  const today = new Date()
  const isCurrentMonth =
    currentMonth.getFullYear() === today.getFullYear() &&
    currentMonth.getMonth() === today.getMonth()

  const loadTurnos = useCallback(async (month: Date) => {
    setIsLoading(true)
    try {
      const data = await fetchTurnosPorMes(
        month.getFullYear(),
        month.getMonth() + 1
      )
      setTurnosPorFecha(data)
    } catch {
      // silent — empty grid is fine
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadTurnos(currentMonth)
  }, [currentMonth, loadTurnos])

  const days = getCalendarDays(currentMonth)
  const weeks: Date[][] = []
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7))
  }

  const totalTurnos = Object.values(turnosPorFecha).flat().length

  return (
    <div className="space-y-4">
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
          {isLoading && (
            <span className="text-sm text-gray-400">Cargando...</span>
          )}
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

      {/* Grid */}
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        {/* Day headers */}
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

        {/* Weeks */}
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 divide-x divide-gray-200">
            {week.map((day, di) => {
              const inMonth = isSameMonth(day, currentMonth)
              const today_ = isToday(day)
              const dateKey = format(day, "yyyy-MM-dd")
              const turnos = turnosPorFecha[dateKey] ?? []

              return (
                <div
                  key={di}
                  className={[
                    "min-h-[100px] p-1.5 flex flex-col gap-1 border-b border-gray-200",
                    !inMonth && "bg-gray-50",
                    today_ && "bg-blue-50",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {/* Day number */}
                  <span
                    className={[
                      "text-sm font-medium w-7 h-7 flex items-center justify-center rounded-full self-start",
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

                  {/* Turno chips */}
                  {turnos.map((turno) => (
                    <div
                      key={turno.id}
                      className={[
                        "text-xs px-1.5 py-0.5 rounded border truncate cursor-pointer",
                        ESTADO_STYLES[turno.estado],
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
      <div className="flex items-center gap-4 text-xs text-gray-500">
        <span className="font-medium">Estados:</span>
        {(Object.entries(ESTADO_STYLES) as [TurnoEstado, string][]).map(([estado, cls]) => (
          <span key={estado} className={`px-2 py-0.5 rounded border ${cls}`}>
            {estado === "asistio" ? "asistió" : estado}
          </span>
        ))}
      </div>
    </div>
  )
}
