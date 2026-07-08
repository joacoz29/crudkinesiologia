"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
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
import { ChevronLeft, ChevronRight, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Turno, TurnoEstado, Especialidad } from "@/types"
import { fetchTurnosPorRango, confirmarAsistencia, desconfirmarAsistencia } from "@/lib/helpers"
import { esDeEspecialidad, filtrarTurnosPorEspecialidad } from "@/lib/especialidades"
import { getCachedMonth, setCachedMonth, clearCachePrefix } from "@/lib/monthly-cache"
import { fetchFeriados } from "@/lib/feriados"
import { NuevoTurnoModal } from "@/components/nuevo-turno-modal"
import { EditarTurnoModal } from "@/components/editar-turno-modal"
import { AgendaDia } from "@/components/agenda-dia"
import { ScrollFab } from "@/components/scroll-fab"
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

export function Calendario({
  refreshTrigger = 0,
  irAFecha,
  irAFechaNonce = 0,
  especialidad = "kinesiologia",
}: {
  refreshTrigger?: number
  /** Fecha (yyyy-MM-dd) a la que saltar (deep-link desde Pendientes) */
  irAFecha?: string
  /** Cambia cada vez que se pide saltar, para re-disparar aunque sea la misma fecha */
  irAFechaNonce?: number
  /** Especialidad activa: filtra la agenda y taggea los turnos nuevos */
  especialidad?: Especialidad
}) {
  const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(new Date()))
  const [turnosPorFecha, setTurnosPorFecha] = useState<Record<string, Turno[]>>({})
  const [isLoading, setIsLoading] = useState(false)
  const [feriados, setFeriados] = useState<Record<string, string>>({}) // { "2026-01-01": "Año Nuevo" }

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

  const loadFeriados = useCallback(async (year: number) => {
    const map = await fetchFeriados([year])
    if (Object.keys(map).length > 0) setFeriados((prev) => ({ ...prev, ...map }))
  }, [])

  // Caché de sesión por mes. Como la grilla de meses adyacentes se solapa, ante
  // CUALQUIER mutación se limpia todo el prefijo (ver reloadTurnos), así que un
  // mes cacheado nunca queda desactualizado. El ahorro es navegar meses sin cambios.
  const loadTurnos = useCallback(async (month: Date, force = false) => {
    const key = `turnos-cal/${format(month, "yyyy-MM")}`
    if (!force) {
      const cached = getCachedMonth<Record<string, Turno[]>>(key)
      if (cached) {
        setTurnosPorFecha(cached)
        return
      }
    }
    setIsLoading(true)
    try {
      // Rango completo de la grilla visible (incluye días de meses adyacentes)
      const gridDays = getCalendarDays(month)
      const data = await fetchTurnosPorRango(
        format(gridDays[0], "yyyy-MM-dd"),
        format(gridDays[gridDays.length - 1], "yyyy-MM-dd")
      )
      setCachedMonth(key, data)
      setTurnosPorFecha(data)
    } catch {
      toast.error("No se pudieron cargar los turnos")
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Recarga tras una mutación: invalida toda la caché de turnos y baja fresco
  const reloadTurnos = useCallback(
    (month: Date) => {
      clearCachePrefix("turnos-cal/")
      loadTurnos(month, true)
    },
    [loadTurnos],
  )

  // Turnos pendientes sin confirmar de los últimos 45 días (independiente del mes visible).
  // Se guarda el crudo y el conteo se deriva por especialidad en memoria (sin re-fetch al togglear).
  const [pendientesPasadosRaw, setPendientesPasadosRaw] = useState<Record<string, Turno[]>>({})

  const loadPendientesPasados = useCallback(async () => {
    try {
      const desde = format(subDays(new Date(), 45), "yyyy-MM-dd")
      const ayer = format(subDays(new Date(), 1), "yyyy-MM-dd")
      setPendientesPasadosRaw(await fetchTurnosPorRango(desde, ayer))
    } catch {
      // no crítico: el banner simplemente no se muestra
    }
  }, [])

  const pendientesPasados = useMemo(() => {
    let count = 0
    let fechaMasAntigua: string | null = null
    for (const [fecha, turnos] of Object.entries(pendientesPasadosRaw)) {
      const pend = turnos.filter((t) => t.estado === "pendiente" && esDeEspecialidad(t, especialidad)).length
      if (pend > 0) {
        count += pend
        if (!fechaMasAntigua || fecha < fechaMasAntigua) fechaMasAntigua = fecha
      }
    }
    return { count, fechaMasAntigua }
  }, [pendientesPasadosRaw, especialidad])

  // Navegación de mes usa la caché; un cambio de refreshTrigger (re-entrar a la
  // pestaña o un cambio externo) invalida y baja fresco.
  const lastTrigger = useRef(refreshTrigger)
  useEffect(() => {
    const triggered = lastTrigger.current !== refreshTrigger
    lastTrigger.current = refreshTrigger
    if (triggered) {
      reloadTurnos(currentMonth)
    } else {
      loadTurnos(currentMonth)
    }
  }, [currentMonth, refreshTrigger, loadTurnos, reloadTurnos])

  useEffect(() => {
    loadPendientesPasados()
  }, [loadPendientesPasados, refreshTrigger])

  useEffect(() => {
    const year = currentMonth.getFullYear()
    loadFeriados(year)
    loadFeriados(year + 1) // preload siguiente año (visible en diciembre)
  }, [currentMonth, loadFeriados])

  // Deep-link desde Pendientes: posiciona el día seleccionado y el mes visible en
  // `irAFecha`. Depende del nonce para re-disparar aunque sea la misma fecha.
  useEffect(() => {
    if (!irAFecha) return
    const [y, m, d] = irAFecha.split("-").map(Number)
    const target = new Date(y, m - 1, d)
    setSelectedDate(target)
    setCurrentMonth(startOfMonth(target))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [irAFechaNonce])

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
    reloadTurnos(currentMonth)
    loadPendientesPasados()
  }

  const handleConfirmarAsistencia = async (turno: Turno, fecha: string): Promise<void> => {
    if (!turno.patientId) return
    try {
      const res = await confirmarAsistencia({
        patientId: turno.patientId,
        turnoId: turno.id,
        fecha,
        hora: turno.hora,
        nombre: turno.nombre,
        apellido: turno.apellido,
      })

      if (res.alreadyConfirmed) {
        toast.info(`El turno de ${turno.nombre} ${turno.apellido} ya estaba confirmado`)
        reloadTurnos(currentMonth)
        loadPendientesPasados()
        return
      }

      const revert = res.revert!
      // Turno de trauma: solo confirma asistencia (no registra sesión de kine → no hay nextNum)
      const msgOk = res.nextNum != null
        ? `Sesión ${res.nextNum} registrada para ${turno.nombre} ${turno.apellido}`
        : `Asistencia confirmada de ${turno.nombre} ${turno.apellido}`
      toast.success(msgOk, {
        duration: 8000,
        action: {
          label: "Deshacer",
          onClick: async () => {
            try {
              await desconfirmarAsistencia(revert, {
                patientId: turno.patientId!,
                nombre: turno.nombre,
                apellido: turno.apellido,
                fecha,
                hora: turno.hora,
              })
              toast.success("Asistencia deshecha")
              reloadTurnos(currentMonth)
              loadPendientesPasados()
            } catch {
              toast.error("No se pudo deshacer la asistencia")
            }
          },
        },
      })

      if (res.remaining != null) {
        if (res.remaining <= 0) {
          toast.warning(`Autorización agotada para ${turno.nombre} ${turno.apellido} — recordá gestionar una nueva`, { duration: 8000 })
        } else if (res.remaining <= 2) {
          toast.warning(`Queda${res.remaining === 1 ? "" : "n"} ${res.remaining} sesión${res.remaining === 1 ? "" : "es"} para ${turno.nombre} ${turno.apellido}`, { duration: 6000 })
        }
      }

      reloadTurnos(currentMonth)
      loadPendientesPasados()
    } catch (err) {
      console.error("[Calendario] confirm error:", err)
      const msg =
        err instanceof Error && err.message === "PACIENTE_NO_ENCONTRADO"
          ? "No se encontró el paciente"
          : err instanceof Error && err.message === "TURNO_NO_ENCONTRADO"
          ? "El turno ya no existe"
          : err instanceof Error && err.message === "TURNO_FUTURO"
          ? "No se puede confirmar asistencia de un turno futuro"
          : "Error al confirmar asistencia"
      toast.error(msg)
      throw err
    }
  }

  const days = getCalendarDays(currentMonth)
  const weeks: Date[][] = []
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7))
  }

  // Filtra por la especialidad activa (en memoria, sin re-fetch). Legacy sin
  // especialidad = kinesiología. Todos los consumidores usan esta versión.
  const turnosVisibles = useMemo(
    () => filtrarTurnosPorEspecialidad(turnosPorFecha, especialidad),
    [turnosPorFecha, especialidad],
  )

  // Solo el mes visible: turnosVisibles también trae días de meses adyacentes de la grilla
  const monthPrefix = format(currentMonth, "yyyy-MM")
  const allTurnos = Object.entries(turnosVisibles)
    .filter(([fecha]) => fecha.startsWith(monthPrefix))
    .flatMap(([, turnos]) => turnos)
  const totalTurnos = allTurnos.filter((t) => t.estado !== "cancelado").length
  const pendientes = allTurnos.filter((t) => t.estado === "pendiente").length
  const asistieron = allTurnos.filter((t) => t.estado === "asistio").length
  const ausentes = allTurnos.filter((t) => t.estado === "ausente").length
  const selectedDateKey = format(selectedDate, "yyyy-MM-dd")
  const selectedDateTurnos = turnosVisibles[selectedDateKey] ?? []

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
                const turnos = turnosVisibles[dateKey] ?? []
                const turnosActivos = turnos.filter((t) => t.estado !== "cancelado")
                const esFeriado = feriados[dateKey]

                return (
                  <div
                    key={di}
                    onClick={() => handleDayClick(day)}
                    className={[
                      "relative h-12 flex flex-col items-center justify-center gap-0.5 border-b border-gray-100",
                      "cursor-pointer transition-[background-color,box-shadow,transform] duration-150 ease-[var(--ease-out)] active:scale-[0.97]",
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
                    {esFeriado && (
                      <span
                        className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-amber-400"
                        title={esFeriado}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>

        {/* Count legend */}
        <div className="flex flex-wrap items-center gap-3 text-[10px] text-gray-400">
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

        {/* Banner: turnos pendientes de días anteriores (últimos 45 días) */}
        {!isLoading && pendientesPasados.count > 0 && pendientesPasados.fechaMasAntigua && (
          <button
            type="button"
            onClick={() => {
              const [y, m, d] = pendientesPasados.fechaMasAntigua!.split("-").map(Number)
              handleDayClick(new Date(y, m - 1, d))
            }}
            className="w-full flex items-center gap-2 px-3 py-2 mb-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm hover:bg-amber-100 transition-colors text-left"
          >
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
            <span>
              <strong>{pendientesPasados.count} turno{pendientesPasados.count !== 1 ? "s" : ""}</strong>
              {" sin confirmar de días anteriores — "}
              <span className="underline">ir al primero</span>
            </span>
          </button>
        )}

        <AgendaDia
          fecha={selectedDate}
          turnos={selectedDateTurnos}
          feriado={feriados[selectedDateKey]}
          onNuevoTurno={(hora) => openNuevoTurno(selectedDate, hora)}
          onEditarTurno={(turno) => {
            setSelectedTurno(turno)
            setSelectedTurnoFecha(selectedDateKey)
            setEditModalOpen(true)
          }}
          onPrevDay={handlePrevDay}
          onNextDay={handleNextDay}
          onConfirmarAsistencia={handleConfirmarAsistencia}
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
        turnosPorFecha={turnosVisibles}
        feriados={feriados}
        especialidad={especialidad}
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

      {/* FAB de scroll: al fondo de la agenda del día, y de vuelta arriba */}
      <ScrollFab labelDown="Ir al final de la agenda" labelUp="Volver arriba" />
    </div>
  )
}
