"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { addDays, subDays } from "date-fns"
import { format } from "date-fns-tz"
import { usePatients } from "@/lib/patients-store"
import { fetchTurnosPorRango, horaToMin } from "@/lib/helpers"
import { filtrarTurnosPorEspecialidad } from "@/lib/especialidades"
import { fetchFeriados } from "@/lib/feriados"
import {
  computeTareasPacientes,
  computeTareasTurnos,
  ordenarTareas,
  tareaKind,
  type Tarea,
  type TareaCategoria,
  type TareaSeveridad,
} from "@/lib/tareas"
import { Patient, Turno, Especialidad } from "@/types"
import { Button } from "@/components/ui/button"
import { EditarTurnoModal } from "@/components/editar-turno-modal"
import { NuevoTurnoModal } from "@/components/nuevo-turno-modal"
import {
  ClipboardList,
  UserCog,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Loader2,
} from "lucide-react"

const TZ = "America/Argentina/Buenos_Aires"
const PAGE_SIZE = 8

// Identidad visual por área: el chip del ícono y el contador llevan un tinte
// semántico propio por categoría, para triar de un vistazo Turnos / Clínico /
// Datos. Se evitan rojo y ámbar a propósito: esos colores son de SEVERIDAD, no
// de categoría. Las acciones siguen en navy para no romper el vocabulario de la app.
const CATEGORIA_META: Record<
  TareaCategoria,
  { label: string; Icon: typeof UserCog; iconWrap: string; count: string }
> = {
  operativo: { label: "Turnos", Icon: CalendarClock, iconWrap: "bg-sky-50 text-sky-600", count: "bg-sky-50 text-sky-700" },
  clinico: { label: "Seguimiento clínico", Icon: ClipboardList, iconWrap: "bg-emerald-50 text-emerald-600", count: "bg-emerald-50 text-emerald-700" },
  datos: { label: "Datos de pacientes", Icon: UserCog, iconWrap: "bg-violet-50 text-violet-600", count: "bg-violet-50 text-violet-700" },
}

const SEV_META: Record<TareaSeveridad, { dot: string }> = {
  alta: { dot: "bg-red-500" },
  media: { dot: "bg-amber-500" },
  baja: { dot: "bg-slate-400" },
}

// Orden de presentación de las secciones (lo más accionable primero)
const ORDEN_CATEGORIAS: TareaCategoria[] = ["operativo", "clinico", "datos"]

// Rango de turnos a leer: -45 días (turnos pendientes pasados) a +120 días
// (próximos turnos). Hora AR.
function rangoTurnos() {
  const hoy = new Date()
  return {
    start: format(subDays(hoy, 45), "yyyy-MM-dd", { timeZone: TZ }),
    end: format(addDays(hoy, 120), "yyyy-MM-dd", { timeZone: TZ }),
  }
}

// Una sección colapsable por categoría, con su propia paginación. Cada sección
// guarda su estado (abierta/cerrada y página) — la `key={cat}` lo mantiene
// estable aunque cambien las tareas.
function CategoriaSeccion({
  cat,
  items,
  onAbrirFicha,
  onAbrirTurno,
  onAgendar,
  onIrCalendario,
}: {
  cat: TareaCategoria
  items: Tarea[]
  onAbrirFicha: (patientId: string) => void
  onAbrirTurno: (ref: { fecha: string; turnoId: string }) => void
  onAgendar: (patientId: string) => void
  onIrCalendario: (fecha: string) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const [page, setPage] = useState(1)
  const { label, Icon, iconWrap, count } = CATEGORIA_META[cat]
  const altaCount = items.filter((t) => t.severidad === "alta").length

  // El contenido queda en el DOM aunque esté colapsado (para animar la altura con
  // grid-rows); `inert` lo saca del foco de teclado mientras la sección está cerrada.
  const contentRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (contentRef.current) contentRef.current.inert = !expanded
  }, [expanded])

  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE))
  const pageClamped = Math.min(page, totalPages) // auto-corrige si bajó la cantidad
  const start = (pageClamped - 1) * PAGE_SIZE
  const visibles = items.slice(start, start + PAGE_SIZE)

  return (
    <section className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 border-b border-slate-100 bg-slate-50/60 hover:bg-slate-100/70 transition-colors text-left"
      >
        <span className={`grid h-8 w-8 place-items-center rounded-lg shrink-0 ${iconWrap}`}>
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <h2 className="text-sm font-semibold text-[#001633]">{label}</h2>
        <span className={`text-xs font-semibold rounded-full px-2 py-0.5 tabular-nums ${count}`}>
          {items.length}
        </span>
        {altaCount > 0 && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600">
            <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
            {altaCount} urgente{altaCount !== 1 ? "s" : ""}
          </span>
        )}
        <ChevronDown
          className={`ml-auto h-4 w-4 text-slate-400 transition-transform duration-200 motion-reduce:transition-none ${expanded ? "" : "-rotate-90"}`}
        />
      </button>

      <div className={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
        <div ref={contentRef} className="overflow-hidden">
          <ul className="divide-y divide-slate-100">
            {visibles.map((t) => (
              <li key={t.id} className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50/60 transition-colors">
                <span
                  className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${SEV_META[t.severidad].dot}`}
                  title={`Prioridad ${t.severidad}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-900">{t.titulo}</p>
                  <p className="text-xs text-slate-600 mt-0.5 break-words">{t.descripcion}</p>
                </div>
                {t.turnoRef ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0 text-slate-400 hover:text-[#001633] hover:bg-slate-100"
                      title="Ver en el calendario"
                      onClick={() => onIrCalendario(t.turnoRef!.fecha)}
                    >
                      <CalendarDays className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 text-[#001633] hover:bg-[#001633] hover:text-white gap-1"
                      onClick={() => onAbrirTurno(t.turnoRef!)}
                    >
                      Marcar asistencia
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : tareaKind(t) === "sin_proximo_turno" && t.patientId ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 shrink-0 text-[#001633] hover:bg-[#001633] hover:text-white gap-1"
                    onClick={() => onAgendar(t.patientId!)}
                  >
                    Agendar turno
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                ) : t.patientId ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 shrink-0 text-[#001633] hover:bg-[#001633] hover:text-white gap-1"
                    onClick={() => onAbrirFicha(t.patientId!)}
                  >
                    Abrir ficha
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-2 border-t border-slate-100 text-xs text-slate-500">
              <span>
                {start + 1}–{Math.min(start + PAGE_SIZE, items.length)} de {items.length}
              </span>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 w-7 p-0"
                  disabled={pageClamped === 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 w-7 p-0"
                  disabled={pageClamped === totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

export function TareasPendientes({
  onAbrirFicha,
  onIrCalendario,
  especialidad = "kinesiologia",
}: {
  onAbrirFicha: (patientId: string) => void
  onIrCalendario: (fecha: string) => void
  // Las tareas de turnos se filtran por la especialidad activa (los turnos de
  // trauma no deben aparecer como "sin marcar" en la Recepción de kine).
  especialidad?: Especialidad
}) {
  const { patients, isLoading: patientsLoading } = usePatients()
  const [turnos, setTurnos] = useState<Record<string, Turno[]>>({})
  const [turnosLoading, setTurnosLoading] = useState(true)
  // Modal de edición de turno (para marcar asistió/ausente desde una tarea)
  const [turnoSel, setTurnoSel] = useState<{ fecha: string; turno: Turno } | null>(null)
  const [turnoModalOpen, setTurnoModalOpen] = useState(false)
  // Modal de nuevo turno (agendar desde la tarea "Sin próximo turno")
  const [pacienteAgenda, setPacienteAgenda] = useState<Patient | null>(null)
  const [agendaOpen, setAgendaOpen] = useState(false)
  const [feriados, setFeriados] = useState<Record<string, string>>({})
  // Fecha base estable para abrir el modal; el usuario elige la real con el picker
  const hoyDate = useMemo(() => new Date(), [])

  // Re-lectura del rango de turnos (también se llama tras marcar un turno: la
  // tarea correspondiente desaparece sola al dejar de estar "pendiente").
  const refetchTurnos = useCallback(() => {
    const { start, end } = rangoTurnos()
    setTurnosLoading(true)
    return fetchTurnosPorRango(start, end)
      .then((t) => setTurnos(t))
      .catch(() => { /* la vista sigue sirviendo las tareas de pacientes */ })
      .finally(() => setTurnosLoading(false))
  }, [])

  // Una sola lectura al montar. Al cambiar de pestaña el componente se desmonta,
  // así que reabrir trae datos frescos (sin caché stale).
  useEffect(() => {
    const { start, end } = rangoTurnos()
    let cancel = false
    setTurnosLoading(true)
    fetchTurnosPorRango(start, end)
      .then((t) => { if (!cancel) setTurnos(t) })
      .catch(() => {})
      .finally(() => { if (!cancel) setTurnosLoading(false) })
    return () => { cancel = true }
  }, [])

  const abrirTurno = useCallback(
    (ref: { fecha: string; turnoId: string }) => {
      const turno = turnos[ref.fecha]?.find((t) => t.id === ref.turnoId)
      if (!turno) {
        // El turno ya no está en memoria (cambió la base): refrescá y no abras.
        refetchTurnos()
        return
      }
      setTurnoSel({ fecha: ref.fecha, turno })
      setTurnoModalOpen(true)
    },
    [turnos, refetchTurnos],
  )

  const agendarTurno = useCallback(
    (patientId: string) => {
      const p = patients.find((x) => x.id === patientId)
      if (!p) return
      setPacienteAgenda(p)
      setAgendaOpen(true)
      // Feriados para que la recurrencia los saltee (lazy, cacheado por año)
      const y = new Date().getFullYear()
      fetchFeriados([y, y + 1]).then(setFeriados).catch(() => {})
    },
    [patients],
  )

  const tareas = useMemo(() => {
    const hoyKey = format(new Date(), "yyyy-MM-dd", { timeZone: TZ })
    const nowMin = horaToMin(format(new Date(), "HH:mm", { timeZone: TZ }))
    const dePacientes = computeTareasPacientes(patients)
    // Solo los turnos de la especialidad activa generan tareas (legacy sin tag = kine)
    const deTurnos = computeTareasTurnos(patients, filtrarTurnosPorEspecialidad(turnos, especialidad), hoyKey, nowMin)
    // Si un paciente tiene "Reautorizar antes del turno", no mostramos además la
    // tarea clínica de "Sesiones agotadas" (sería redundante).
    const reautorizar = new Set(
      deTurnos.filter((t) => t.id.startsWith("reautorizar:")).map((t) => t.patientId),
    )
    const dePacientesFiltradas = dePacientes.filter(
      (t) => !(t.id.startsWith("sesiones_por_agotar:") && t.patientId && reautorizar.has(t.patientId)),
    )
    return ordenarTareas([...dePacientesFiltradas, ...deTurnos])
  }, [patients, turnos, especialidad])

  const porCategoria = useMemo(() => {
    const map: Record<TareaCategoria, Tarea[]> = { datos: [], clinico: [], operativo: [] }
    for (const t of tareas) map[t.categoria].push(t)
    return map
  }, [tareas])

  const urgentes = useMemo(() => tareas.filter((t) => t.severidad === "alta").length, [tareas])

  if (patientsLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-slate-200 p-4 animate-pulse">
            <div className="h-4 w-40 bg-slate-200 rounded mb-3" />
            <div className="h-3 w-64 bg-slate-100 rounded" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold text-[#001633]">Recepción</h1>
          <p className="text-sm text-slate-500 mt-1">
            {tareas.length === 0 ? (
              "Sin pendientes detectados"
            ) : (
              <>
                <span className="font-medium text-slate-700">{tareas.length}</span> pendiente
                {tareas.length !== 1 ? "s" : ""} para revisar
                {urgentes > 0 && (
                  <>
                    {" · "}
                    <span className="font-medium text-red-600">
                      {urgentes} urgente{urgentes !== 1 ? "s" : ""}
                    </span>
                  </>
                )}
              </>
            )}
            {turnosLoading && (
              <span className="inline-flex items-center gap-1 ml-2 text-slate-400">
                <Loader2 className="h-3 w-3 animate-spin" /> actualizando turnos…
              </span>
            )}
          </p>
        </div>
      </div>

      {!turnosLoading && tareas.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-20 text-slate-400 bg-white rounded-xl border border-slate-200">
          <CheckCircle2 className="h-12 w-12 text-emerald-400" />
          <p className="font-medium text-slate-600">¡Todo al día!</p>
          <p className="text-sm">No hay datos faltantes ni turnos sin marcar.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {ORDEN_CATEGORIAS.map((cat) => {
            const items = porCategoria[cat]
            if (items.length === 0) return null
            return (
              <CategoriaSeccion
                key={cat}
                cat={cat}
                items={items}
                onAbrirFicha={onAbrirFicha}
                onAbrirTurno={abrirTurno}
                onAgendar={agendarTurno}
                onIrCalendario={onIrCalendario}
              />
            )
          })}
        </div>
      )}

      {turnoSel && (
        <EditarTurnoModal
          open={turnoModalOpen}
          onOpenChange={(o) => {
            setTurnoModalOpen(o)
            if (!o) setTurnoSel(null)
          }}
          fecha={turnoSel.fecha}
          turno={turnoSel.turno}
          onSaved={refetchTurnos}
        />
      )}

      {pacienteAgenda && (
        <NuevoTurnoModal
          open={agendaOpen}
          onOpenChange={(o) => {
            setAgendaOpen(o)
            if (!o) setPacienteAgenda(null)
          }}
          fecha={hoyDate}
          pacienteInicial={pacienteAgenda}
          permitirElegirFecha
          turnosPorFecha={turnos}
          feriados={feriados}
          onSaved={refetchTurnos}
        />
      )}
    </div>
  )
}
