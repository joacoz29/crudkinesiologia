"use client"

import { useState, useEffect, useMemo, useRef } from "react"
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

// Every N calendar days; if result is weekend, moves to Monday
function generarFechasIntervalo(base: Date, intervalo: number, vecesTotal: number): Date[] {
  return Array.from({ length: Math.max(1, vecesTotal) }, (_, i) => {
    const d = new Date(base)
    d.setDate(d.getDate() + i * Math.max(1, intervalo))
    return snapToWeekday(d)
  })
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

// Weekday dates until numTurnos is reached
function generarFechasSemanalPorTurnos(base: Date, diasJS: number[], numTurnos: number): Date[] {
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
      if (d >= baseNorm) fechas.push(new Date(d))
    }
  }
  return fechas.sort((a, b) => a.getTime() - b.getTime())
}

interface NuevoTurnoModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  fecha: Date
  horaInicial?: string
  onSaved: () => void
  turnosPorFecha: Record<string, Turno[]>
}

export function NuevoTurnoModal({
  open,
  onOpenChange,
  fecha,
  horaInicial = "09:00",
  onSaved,
  turnosPorFecha,
}: NuevoTurnoModalProps) {
  const [patients, setPatients] = useState<Patient[]>([])
  const [search, setSearch] = useState("")
  const [isSearching, setIsSearching] = useState(false)
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null)
  const [hora, setHora] = useState(horaInicial)
  const [notas, setNotas] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const searchAbortRef = useRef<ReturnType<typeof setTimeout> | null>(null)
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
    if (!search.trim()) {
      setPatients([])
      setIsSearching(false)
      return
    }
    if (searchAbortRef.current) clearTimeout(searchAbortRef.current)
    setIsSearching(true)
    searchAbortRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/patients?search=${encodeURIComponent(search.trim())}&limit=10`)
        if (!res.ok) return
        const data = await res.json()
        setPatients(data.patients ?? [])
      } catch {}
      finally { setIsSearching(false) }
    }, 250)
    return () => { if (searchAbortRef.current) clearTimeout(searchAbortRef.current) }
  }, [search])

  useEffect(() => {
    if (open) {
      setSearch("")
      setPatients([])
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

  // Preview of dates that will be created
  const fechasPreview = useMemo(() => {
    if (repeticion === "ninguna") return [fecha]
    if (repeticion === "intervalo") return generarFechasIntervalo(fecha, intervalo, vecesTotal)
    if (tipoLimite === "turnos") return generarFechasSemanalPorTurnos(fecha, diasSemana, numTurnos)
    return generarFechasSemanal(fecha, diasSemana, numSemanas)
  }, [repeticion, fecha, intervalo, vecesTotal, diasSemana, tipoLimite, numSemanas, numTurnos])

  const canSave =
    !!selectedPatient &&
    (repeticion !== "semanal" || diasSemana.length > 0) &&
    fechasPreview.length > 0

  const filtered = patients

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
          if (dayTurnos.some((t) => t.patientId === selectedPatient.id)) {
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
                    {isSearching ? (
                      <p className="px-3 py-2 text-sm text-gray-400">Buscando...</p>
                    ) : filtered.length > 0 ? (
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
            {repeticion !== "ninguna" && fechasPreview.length > 0 && (
              <div className="bg-gray-50 rounded-md p-2.5 text-xs text-gray-600 space-y-1">
                <p className="font-medium text-gray-700">
                  Se crearán {fechasPreview.length} turno{fechasPreview.length !== 1 ? "s" : ""}:
                </p>
                <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                  {fechasPreview.map((f, i) => {
                    const fKey = format(f, "yyyy-MM-dd")
                    const hasConflict = (turnosPorFecha[fKey] ?? []).some(
                      (t) => t.hora === hora && t.estado !== "cancelado"
                    )
                    return (
                      <span
                        key={i}
                        className={[
                          "inline-flex items-center gap-1 border rounded px-1.5 py-0.5 capitalize text-xs",
                          hasConflict
                            ? "bg-amber-50 border-amber-300 text-amber-800"
                            : "bg-white border-gray-200 text-gray-700",
                        ].join(" ")}
                        title={hasConflict ? `Ya hay turnos a las ${hora} este día` : undefined}
                      >
                        {hasConflict && <AlertTriangle className="h-2.5 w-2.5 shrink-0" />}
                        {format(f, "EEE d MMM", { locale: es })}
                      </span>
                    )
                  })}
                </div>
              </div>
            )}
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
