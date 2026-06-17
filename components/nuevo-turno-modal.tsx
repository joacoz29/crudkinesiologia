"use client"

import { useState, useEffect, useMemo } from "react"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ref, push, get } from "firebase/database"
import { db } from "@/lib/firebase"
import { writeLog, getSessionStats } from "@/lib/helpers"
import { usePatients, queryPatients } from "@/lib/patients-store"
import { Patient, Turno } from "@/types"
import { toast } from "sonner"
import { AlertTriangle } from "lucide-react"

type Repeticion = "ninguna" | "intervalo" | "semanal"

// Only weekdays L-V
const DIAS_SEMANA = [
  { label: "L", value: 1 },
  { label: "M", value: 2 },
  { label: "X", value: 3 },
  { label: "J", value: 4 },
  { label: "V", value: 5 },
]

function snapToWeekday(d: Date): Date {
  const result = new Date(d)
  const day = result.getDay()
  if (day === 6) result.setDate(result.getDate() + 2) // Sat → Mon
  if (day === 0) result.setDate(result.getDate() + 1) // Sun → Mon
  return result
}

// Every N calendar days; if result is weekend, moves to Monday.
// Dedupes: with intervals cortos, varios días pueden caer (snapeados) en el mismo lunes.
function generarFechasIntervalo(base: Date, intervalo: number, vecesTotal: number): Date[] {
  const fechas: Date[] = []
  const seen = new Set<string>()
  for (let i = 0; i < Math.max(1, vecesTotal); i++) {
    const d = new Date(base)
    d.setDate(d.getDate() + i * Math.max(1, intervalo))
    const snapped = snapToWeekday(d)
    const key = format(snapped, "yyyy-MM-dd")
    if (!seen.has(key)) {
      seen.add(key)
      fechas.push(snapped)
    }
  }
  return fechas
}

function lunesDeSemanaDe(base: Date): Date {
  const day = base.getDay()
  const offset = day === 0 ? 6 : day - 1
  const lunes = new Date(base)
  lunes.setDate(lunes.getDate() - offset)
  lunes.setHours(0, 0, 0, 0)
  return lunes
}

// Weekday dates for numSemanas weeks starting from base's week
function generarFechasSemanal(base: Date, diasJS: number[], numSemanas: number): Date[] {
  if (diasJS.length === 0) return []
  const lunes = lunesDeSemanaDe(base)
  const baseNorm = new Date(base); baseNorm.setHours(0, 0, 0, 0)
  const fechas: Date[] = []
  for (let s = 0; s < Math.max(1, numSemanas); s++) {
    for (const dia of diasJS) {
      const offset = dia === 0 ? 6 : dia - 1
      const d = new Date(lunes)
      d.setDate(d.getDate() + s * 7 + offset)
      if (d >= baseNorm) fechas.push(new Date(d))
    }
  }
  return fechas.sort((a, b) => a.getTime() - b.getTime())
}

// Weekday dates until numTurnos is reached, skipping holidays
function generarFechasSemanalPorTurnos(
  base: Date, diasJS: number[], numTurnos: number, feriadosSet: Set<string>
): Date[] {
  if (diasJS.length === 0) return []
  const lunes = lunesDeSemanaDe(base)
  const baseNorm = new Date(base); baseNorm.setHours(0, 0, 0, 0)
  const fechas: Date[] = []
  for (let s = 0; fechas.length < Math.max(1, numTurnos) && s < 200; s++) {
    for (const dia of diasJS) {
      if (fechas.length >= numTurnos) break
      const offset = dia === 0 ? 6 : dia - 1
      const d = new Date(lunes)
      d.setDate(d.getDate() + s * 7 + offset)
      if (d >= baseNorm && !feriadosSet.has(format(d, "yyyy-MM-dd"))) fechas.push(new Date(d))
    }
  }
  return fechas.sort((a, b) => a.getTime() - b.getTime())
}

function filtrarFeriados(fechas: Date[], feriadosSet: Set<string>): Date[] {
  return fechas.filter((d) => !feriadosSet.has(format(d, "yyyy-MM-dd")))
}

interface NuevoTurnoModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  fecha: Date
  horaInicial?: string
  onSaved: () => void
  turnosPorFecha: Record<string, Turno[]>
  feriados?: Record<string, string>
}

export function NuevoTurnoModal({
  open,
  onOpenChange,
  fecha,
  horaInicial = "09:00",
  onSaved,
  turnosPorFecha,
  feriados = {},
}: NuevoTurnoModalProps) {
  // Caché compartida: la búsqueda de pacientes se resuelve en memoria
  const { patients: allPatients, isLoading: isLoadingPatients } = usePatients()
  const [search, setSearch] = useState("")
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null)
  const [hora, setHora] = useState(horaInicial)
  const [notas, setNotas] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const [conflictDates, setConflictDates] = useState<string[]>([])
  const [conflictDialogOpen, setConflictDialogOpen] = useState(false)

  // Repetición
  const [repeticion, setRepeticion] = useState<Repeticion>("ninguna")
  const [intervalo, setIntervalo] = useState(7)
  const [vecesTotal, setVecesTotal] = useState(4)
  const [diasSemana, setDiasSemana] = useState<number[]>([])
  const [tipoLimite, setTipoLimite] = useState<"semanas" | "turnos">("semanas")
  const [numSemanas, setNumSemanas] = useState(4)
  const [numTurnos, setNumTurnos] = useState(10)

  useEffect(() => {
    if (open) {
      setSearch("")
      setSelectedPatient(null)
      setHora(horaInicial)
      setNotas("")
      setShowDropdown(false)
      setRepeticion("ninguna")
      setIntervalo(7)
      setVecesTotal(4)
      // Pre-select weekday of chosen date (only if it's Mon-Fri)
      const wd = fecha.getDay()
      setDiasSemana(wd >= 1 && wd <= 5 ? [wd] : [])
      setTipoLimite("semanas")
      setNumSemanas(4)
      setNumTurnos(10)
      setConflictDates([])
      setConflictDialogOpen(false)
    }
  }, [open, horaInicial, fecha])

  const toggleDia = (dia: number) => {
    setDiasSemana((prev) =>
      prev.includes(dia) ? prev.filter((d) => d !== dia) : [...prev, dia]
    )
  }

  const feriadosSet = useMemo(() => new Set(Object.keys(feriados)), [feriados])

  const sessionStats = useMemo(
    () => (selectedPatient ? getSessionStats(selectedPatient) : null),
    [selectedPatient]
  )

  // Raw candidates before holiday filter — used only for preview display (shows strikethrough on skipped days)
  const fechasTodasCandidatas = useMemo(() => {
    if (repeticion === "ninguna") return [fecha]
    if (repeticion === "intervalo") return generarFechasIntervalo(fecha, intervalo, vecesTotal)
    if (tipoLimite === "turnos") return [] // por-turnos derives its own list internally
    return generarFechasSemanal(fecha, diasSemana, numSemanas)
  }, [repeticion, fecha, intervalo, vecesTotal, diasSemana, tipoLimite, numSemanas])

  // Dates that will actually be saved (holidays excluded)
  const fechasPreview = useMemo(() => {
    if (repeticion === "ninguna") return [fecha]
    if (repeticion === "intervalo")
      return filtrarFeriados(generarFechasIntervalo(fecha, intervalo, vecesTotal), feriadosSet)
    if (tipoLimite === "turnos")
      return generarFechasSemanalPorTurnos(fecha, diasSemana, numTurnos, feriadosSet)
    return filtrarFeriados(generarFechasSemanal(fecha, diasSemana, numSemanas), feriadosSet)
  }, [repeticion, fecha, intervalo, vecesTotal, diasSemana, tipoLimite, numSemanas, numTurnos, feriadosSet])

  const canSave =
    !!selectedPatient &&
    (repeticion !== "semanal" || diasSemana.length > 0) &&
    fechasPreview.length > 0

  const filtered = useMemo(
    () => (search.trim() ? queryPatients(allPatients, { search: search.trim(), limit: 10 }).patients : []),
    [allPatients, search],
  )

  const dateKey = format(fecha, "yyyy-MM-dd")
  const horaConflicts = (turnosPorFecha[dateKey] ?? []).filter(
    (t) => t.hora === hora && t.estado !== "cancelado"
  )

  const doSave = async () => {
    const turnoBase: Record<string, unknown> = {
      patientId: selectedPatient!.id,
      nombre: selectedPatient!.nombre,
      apellido: selectedPatient!.apellido,
      hora,
      estado: "pendiente",
    }
    if (notas.trim()) turnoBase.notas = notas.trim()

    const results = await Promise.allSettled(
      fechasPreview.map((f) =>
        push(ref(db, `turnos/${format(f, "yyyy-MM-dd")}`), turnoBase)
      )
    )

    const saved = results.filter((r) => r.status === "fulfilled").length
    const failed = results.filter((r) => r.status === "rejected").length

    if (failed === 0) {
      toast.success(saved > 1 ? `${saved} turnos guardados` : "Turno guardado")
    } else if (saved === 0) {
      toast.error("No se pudo guardar ningún turno")
    } else {
      toast.warning(`${saved} turno${saved !== 1 ? "s" : ""} guardado${saved !== 1 ? "s" : ""}, ${failed} fallaron`)
    }

    if (saved > 0) {
      await writeLog({ accion: "crear_turno", detalle: `Creó ${saved} turno${saved !== 1 ? "s" : ""} para ${selectedPatient!.nombre} ${selectedPatient!.apellido} a las ${hora}`, entidadId: selectedPatient!.id })
      onSaved()
      onOpenChange(false)
    }
  }

  const handleSave = async () => {
    if (!selectedPatient) {
      toast.error("Seleccioná un paciente")
      return
    }
    if (repeticion === "semanal" && diasSemana.length === 0) {
      toast.error("Seleccioná al menos un día de la semana")
      return
    }

    setIsSaving(true)
    try {
      // Check for double bookings on each preview date
      const dateKeys = [...new Set(fechasPreview.map((f) => format(f, "yyyy-MM-dd")))]
      const snapshots = await Promise.all(dateKeys.map((d) => get(ref(db, `turnos/${d}`))))
      const conflicts: string[] = []
      dateKeys.forEach((dateKey, i) => {
        const snap = snapshots[i]
        if (snap.exists()) {
          const dayTurnos = Object.values(snap.val() as Record<string, unknown>) as Turno[]
          if (dayTurnos.some((t) => t.patientId === selectedPatient.id && t.estado !== "cancelado")) {
            conflicts.push(dateKey)
          }
        }
      })

      if (conflicts.length > 0) {
        setConflictDates(conflicts)
        setConflictDialogOpen(true)
        return
      }

      await doSave()
    } catch {
      toast.error("Error inesperado al guardar los turnos")
    } finally {
      setIsSaving(false)
    }
  }

  const handleConfirmSave = async () => {
    setConflictDialogOpen(false)
    setIsSaving(true)
    try {
      await doSave()
    } catch {
      toast.error("Error inesperado al guardar los turnos")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="capitalize">
            Nuevo turno — {format(fecha, "EEEE d 'de' MMMM", { locale: es })}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Paciente */}
          <div className="space-y-2">
            <Label>Paciente</Label>
            {selectedPatient ? (
              <div className="flex items-center justify-between px-3 py-2 border border-[#001633] rounded-md bg-blue-50">
                <div>
                  <span className="text-sm font-medium">
                    {selectedPatient.nombre} {selectedPatient.apellido}
                  </span>
                  {selectedPatient.obraSocial && (
                    <span className="text-xs text-gray-500 ml-2">
                      {selectedPatient.obraSocial}
                    </span>
                  )}
                  {sessionStats && (() => {
                    const { used, authorized } = sessionStats
                    const exhausted = used >= authorized
                    const nearLimit = used >= Math.ceil(authorized * 0.8)
                    return (
                      <div className="flex items-center gap-1 mt-0.5">
                        {(exhausted || nearLimit) && (
                          <AlertTriangle className={`h-3 w-3 shrink-0 ${exhausted ? "text-red-500" : "text-amber-500"}`} />
                        )}
                        <span className={`text-xs ${
                          exhausted ? "text-red-600 font-medium"
                          : nearLimit ? "text-amber-600"
                          : "text-gray-400"
                        }`}>
                          {exhausted
                            ? `Autorización agotada (${used}/${authorized} ses.)`
                            : `${used}/${authorized} sesiones`}
                        </span>
                      </div>
                    )
                  })()}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs"
                  onClick={() => { setSelectedPatient(null); setSearch("") }}
                >
                  Cambiar
                </Button>
              </div>
            ) : (
              <div className="relative">
                <Input
                  placeholder="Buscar por nombre o apellido..."
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setShowDropdown(true) }}
                  onFocus={() => setShowDropdown(true)}
                  onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
                  className="border-[#001633]"
                  autoComplete="off"
                />
                {showDropdown && search && (
                  <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-52 overflow-y-auto">
                    {filtered.length > 0 ? (
                      filtered.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex justify-between items-center"
                          onMouseDown={() => { setSelectedPatient(p); setSearch(""); setShowDropdown(false) }}
                        >
                          <span>{p.nombre} {p.apellido}</span>
                          <span className="text-xs text-gray-400">{p.obraSocial}</span>
                        </button>
                      ))
                    ) : isLoadingPatients ? (
                      <p className="px-3 py-2 text-sm text-gray-400">Cargando pacientes…</p>
                    ) : (
                      <p className="px-3 py-2 text-sm text-gray-500">Sin resultados</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Hora */}
          <div className="space-y-2">
            <Label htmlFor="hora">Horario</Label>
            <Input
              id="hora"
              type="time"
              value={hora}
              onChange={(e) => setHora(e.target.value)}
              className="border-[#001633] w-36"
            />
            {horaConflicts.length > 0 && (
              <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                <div className="text-xs text-amber-800">
                  <p className="font-medium">
                    {horaConflicts.length === 1
                      ? "Ya hay 1 turno a esta hora:"
                      : `Ya hay ${horaConflicts.length} turnos a esta hora:`}
                  </p>
                  <ul className="mt-0.5 space-y-0.5">
                    {horaConflicts.map((t) => (
                      <li key={t.id}>· {t.nombre} {t.apellido}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>

          {/* Notas */}
          <div className="space-y-2">
            <Label htmlFor="notas">
              Notas <span className="text-gray-400 font-normal text-xs">(opcional)</span>
            </Label>
            <Textarea
              id="notas"
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="Observaciones del turno..."
              className="min-h-[72px] border-[#001633]"
            />
          </div>

          {/* Repetición */}
          <div className="space-y-3 border-t border-gray-100 pt-3">
            <Label>Repetición</Label>
            <div className="flex gap-2">
              {(["ninguna", "intervalo", "semanal"] as Repeticion[]).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setRepeticion(opt)}
                  className={[
                    "px-3 py-1.5 text-sm rounded-full border transition-colors",
                    repeticion === opt
                      ? "bg-[#001633] text-white border-[#001633]"
                      : "border-gray-200 text-gray-600 hover:border-[#001633]",
                  ].join(" ")}
                >
                  {opt === "ninguna" ? "Una vez" : opt === "intervalo" ? "Cada N días" : "Semanal"}
                </button>
              ))}
            </div>

            {repeticion === "intervalo" && (
              <div className="flex items-center gap-2 text-sm text-gray-700 flex-wrap">
                <span>Cada</span>
                <Input
                  type="number"
                  min={1}
                  max={90}
                  value={intervalo}
                  onChange={(e) => setIntervalo(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-16 border-[#001633] h-8 text-center"
                />
                <span>días,</span>
                <Input
                  type="number"
                  min={1}
                  max={52}
                  value={vecesTotal}
                  onChange={(e) => setVecesTotal(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-16 border-[#001633] h-8 text-center"
                />
                <span>veces en total</span>
              </div>
            )}

            {repeticion === "semanal" && (
              <div className="space-y-3">
                {/* Weekday picker — Mon to Fri + optional Sat */}
                <div className="flex gap-1.5 items-center">
                  {DIAS_SEMANA.map(({ label, value }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => toggleDia(value)}
                      className={[
                        "w-9 h-9 rounded-full text-xs font-semibold border transition-colors",
                        diasSemana.includes(value)
                          ? "bg-[#001633] text-white border-[#001633]"
                          : "border-gray-200 text-gray-600 hover:border-[#001633]",
                      ].join(" ")}
                    >
                      {label}
                    </button>
                  ))}
                  <span className="text-gray-300 select-none">|</span>
                  <button
                    type="button"
                    onClick={() => toggleDia(6)}
                    title="Sábado — ocasión especial"
                    className={[
                      "w-9 h-9 rounded-full text-xs font-semibold border transition-colors",
                      diasSemana.includes(6)
                        ? "bg-amber-500 text-white border-amber-500"
                        : "border-dashed border-amber-400 text-amber-600 hover:bg-amber-50",
                    ].join(" ")}
                  >
                    S
                  </button>
                </div>

                {/* Limit mode toggle */}
                <div className="flex gap-2">
                  {(["semanas", "turnos"] as const).map((modo) => (
                    <button
                      key={modo}
                      type="button"
                      onClick={() => setTipoLimite(modo)}
                      className={[
                        "px-3 py-1 text-xs rounded-full border transition-colors",
                        tipoLimite === modo
                          ? "bg-[#001633] text-white border-[#001633]"
                          : "border-gray-200 text-gray-600 hover:border-[#001633]",
                      ].join(" ")}
                    >
                      Por {modo}
                    </button>
                  ))}
                </div>

                {tipoLimite === "semanas" ? (
                  <div className="flex items-center gap-2 text-sm text-gray-700">
                    <Input
                      type="number"
                      min={1}
                      max={52}
                      value={numSemanas}
                      onChange={(e) => setNumSemanas(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-16 border-[#001633] h-8 text-center"
                    />
                    <span>semana{numSemanas !== 1 ? "s" : ""}</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-sm text-gray-700">
                    <Input
                      type="number"
                      min={1}
                      max={200}
                      value={numTurnos}
                      onChange={(e) => setNumTurnos(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-16 border-[#001633] h-8 text-center"
                    />
                    <span>turno{numTurnos !== 1 ? "s" : ""} en total</span>
                  </div>
                )}
              </div>
            )}

            {/* Preview */}
            {repeticion !== "ninguna" && (() => {
              const byTurnos = repeticion === "semanal" && tipoLimite === "turnos"
              const displayDates = byTurnos ? fechasPreview : fechasTodasCandidatas
              const feriadosOmitidos = byTurnos
                ? 0
                : displayDates.filter((d) => feriadosSet.has(format(d, "yyyy-MM-dd"))).length
              if (displayDates.length === 0) return null
              return (
                <div className="bg-gray-50 rounded-md p-2.5 text-xs text-gray-600 space-y-1">
                  <p className="font-medium text-gray-700">
                    Se crearán {fechasPreview.length} turno{fechasPreview.length !== 1 ? "s" : ""}
                    {feriadosOmitidos > 0 && (
                      <span className="ml-1.5 font-normal text-amber-600">
                        · {feriadosOmitidos} feriado{feriadosOmitidos !== 1 ? "s" : ""} omitido{feriadosOmitidos !== 1 ? "s" : ""}
                      </span>
                    )}
                    :
                  </p>
                  <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                    {displayDates.map((f, i) => {
                      const fKey = format(f, "yyyy-MM-dd")
                      const esFeriado = feriadosSet.has(fKey)
                      const hasConflict =
                        !esFeriado &&
                        (turnosPorFecha[fKey] ?? []).some(
                          (t) => t.hora === hora && t.estado !== "cancelado"
                        )
                      return (
                        <span
                          key={i}
                          className={[
                            "inline-flex items-center gap-1 border rounded px-1.5 py-0.5 capitalize text-xs",
                            esFeriado
                              ? "bg-gray-100 border-gray-200 text-gray-400 line-through"
                              : hasConflict
                              ? "bg-amber-50 border-amber-300 text-amber-800"
                              : "bg-white border-gray-200 text-gray-700",
                          ].join(" ")}
                          title={
                            esFeriado
                              ? `Feriado: ${feriados[fKey]}`
                              : hasConflict
                              ? `Ya hay turnos a las ${hora} este día`
                              : undefined
                          }
                        >
                          {!esFeriado && hasConflict && <AlertTriangle className="h-2.5 w-2.5 shrink-0" />}
                          {format(f, "EEE d MMM", { locale: es })}
                        </span>
                      )
                    })}
                  </div>
                </div>
              )
            })()}
          </div>

          <Button
            onClick={handleSave}
            disabled={isSaving || !canSave}
            className="w-full bg-[#001633] hover:bg-[#002966]"
          >
            {isSaving
              ? "Guardando..."
              : fechasPreview.length > 1
              ? `Guardar ${fechasPreview.length} turnos`
              : "Guardar turno"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    <AlertDialog open={conflictDialogOpen} onOpenChange={setConflictDialogOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Turno duplicado</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>
              <p className="mb-2">
                {selectedPatient?.nombre} {selectedPatient?.apellido} ya tiene un turno en:
              </p>
              <ul className="list-disc list-inside space-y-0.5 text-sm font-medium text-gray-800">
                {conflictDates.map((d) => {
                  const [y, m, day] = d.split("-")
                  return (
                    <li key={d} className="capitalize">
                      {format(new Date(Number(y), Number(m) - 1, Number(day)), "EEEE d 'de' MMMM", { locale: es })}
                    </li>
                  )
                })}
              </ul>
              <p className="mt-2">¿Guardar de todos modos?</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirmSave} className="bg-[#001633] hover:bg-[#002966]">
            Guardar de todos modos
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  )
}
