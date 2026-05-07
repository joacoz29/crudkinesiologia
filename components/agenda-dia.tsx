"use client"

import { format } from "date-fns"
import { es } from "date-fns/locale"
import { Plus } from "lucide-react"
import { Turno, TurnoEstado } from "@/types"

const HOURS = Array.from({ length: 12 }, (_, i) => i + 8) // 8 → 19

const ESTADO_STYLES: Record<TurnoEstado, string> = {
  pendiente: "bg-blue-100 text-blue-800 border-blue-200",
  asistio: "bg-green-100 text-green-800 border-green-200",
  ausente: "bg-red-100 text-red-800 border-red-200",
  cancelado: "bg-gray-100 text-gray-500 border-gray-200 line-through",
}

const ESTADO_LABELS: Record<TurnoEstado, string> = {
  pendiente: "Pendiente",
  asistio: "Asistió",
  ausente: "Ausente",
  cancelado: "Cancelado",
}

interface AgendaDiaProps {
  fecha: Date
  turnos: Turno[]
  onNuevoTurno: (hora: string) => void
  onEditarTurno: (turno: Turno) => void
}

export function AgendaDia({ fecha, turnos, onNuevoTurno, onEditarTurno }: AgendaDiaProps) {
  const turnosPorHora = HOURS.reduce<Record<number, Turno[]>>((acc, h) => {
    acc[h] = turnos.filter((t) => parseInt(t.hora.split(":")[0], 10) === h)
    return acc
  }, {})

  const totalAgendados = turnos.length
  const horasLibres = HOURS.filter((h) => turnosPorHora[h].length === 0).length

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-[#001633] capitalize">
            {format(fecha, "EEEE d 'de' MMMM", { locale: es })}
          </h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {totalAgendados} turno{totalAgendados !== 1 ? "s" : ""} agendado{totalAgendados !== 1 ? "s" : ""} · {horasLibres} hora{horasLibres !== 1 ? "s" : ""} libre{horasLibres !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {/* Timeline */}
      <div className="border border-gray-200 rounded-lg overflow-hidden divide-y divide-gray-100">
        {HOURS.map((hour) => {
          const hourLabel = `${String(hour).padStart(2, "0")}:00`
          const horasTurnos = turnosPorHora[hour]
          const libre = horasTurnos.length === 0

          return (
            <div
              key={hour}
              className={[
                "flex min-h-[52px]",
                libre ? "hover:bg-gray-50 group cursor-pointer" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={libre ? () => onNuevoTurno(hourLabel) : undefined}
            >
              {/* Hour label */}
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

              {/* Content */}
              <div className="flex-1 px-3 py-2 flex flex-col gap-1.5 justify-center">
                {libre ? (
                  <span className="text-xs text-gray-300 group-hover:text-gray-400 flex items-center gap-1 transition-colors">
                    <Plus className="h-3 w-3" />
                    Agregar turno
                  </span>
                ) : (
                  horasTurnos.map((turno) => (
                    <button
                      key={turno.id}
                      onClick={(e) => {
                        e.stopPropagation()
                        onEditarTurno(turno)
                      }}
                      className={[
                        "text-left text-sm px-3 py-1.5 rounded border w-full max-w-sm",
                        "hover:opacity-75 transition-opacity",
                        ESTADO_STYLES[turno.estado],
                      ].join(" ")}
                    >
                      <div className="flex items-center justify-between gap-4">
                        <span className="font-medium">
                          {turno.hora} — {turno.nombre} {turno.apellido}
                        </span>
                        <span className="text-xs opacity-70 shrink-0">
                          {ESTADO_LABELS[turno.estado]}
                        </span>
                      </div>
                      {turno.notas && (
                        <p className="text-xs opacity-60 mt-0.5 truncate">{turno.notas}</p>
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
