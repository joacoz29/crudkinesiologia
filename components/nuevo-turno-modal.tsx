"use client"

import { useState, useEffect, useMemo } from "react"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ref, get, push } from "firebase/database"
import { db } from "@/lib/firebase"
import { Patient } from "@/types"
import { toast } from "sonner"

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
  const day = d.getDay()
  if (day === 6) d.setDate(d.getDate() + 2) // Sat → Mon
  if (day === 0) d.setDate(d.getDate() + 1) // Sun → Mon
  return d
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
}

export function NuevoTurnoModal({
  open,
  onOpenChange,
  fecha,
  horaInicial = "09:00",
  onSaved,
}: NuevoTurnoModalProps) {
  const [patients, setPatients] = useState<Patient[]>([])
  const [search, setSearch] = useState("")
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null)
  const [hora, setHora] = useState(horaInicial)
  const [notas, setNotas] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)

  // Repetición
  const [repeticion, setRepeticion] = useState<Repeticion>("ninguna")
  const [intervalo, setIntervalo] = useState(7)
  const [vecesTotal, setVecesTotal] = useState(4)
  const [diasSemana, setDiasSemana] = useState<number[]>([])
  const [tipoLimite, setTipoLimite] = useState<"semanas" | "turnos">("semanas")
  const [numSemanas, setNumSemanas] = useState(4)
  const [numTurnos, setNumTurnos] = useState(10)

  useEffect(() => {
    if (!open) return
    get(ref(db, "pacientes"))
      .then((snapshot) => {
        if (!snapshot.exists()) return
        const data = snapshot.val() as Record<string, Record<string, unknown>>
        const list: Patient[] = Object.entries(data).map(([id, raw]) => {
          const sesiones = Array.isArray(raw.sesiones)
            ? (raw.sesiones as string[])
            : typeof raw.sesiones === "string"
            ? (raw.sesiones as string).split(", ").filter(Boolean)
            : []
          return { id, ...raw, sesiones } as Patient
        })
        list.sort((a, b) => a.apellido.localeCompare(b.apellido))
        setPatients(list)
      })
      .catch(() => {})
  }, [open])

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
    .filter((p) => {
      const q = search.toLowerCase()
      return (
        p.nombre?.toLowerCase().includes(q) ||
        p.apellido?.toLowerCase().includes(q) ||
        `${p.nombre} ${p.apellido}`.toLowerCase().includes(q) ||
        `${p.apellido} ${p.nombre}`.toLowerCase().includes(q)
      )
    })
    .slice(0, 10)

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
      const turnoBase: Record<string, unknown> = {
        patientId: selectedPatient.id,
        nombre: selectedPatient.nombre,
        apellido: selectedPatient.apellido,
        hora,
        estado: "pendiente",
      }
      if (notas.trim()) turnoBase.notas = notas.trim()

      await Promise.all(
        fechasPreview.map((f) =>
          push(ref(db, `turnos/${format(f, "yyyy-MM-dd")}`), turnoBase)
        )
      )

      const plural = fechasPreview.length > 1
      toast.success(
        plural
          ? `${fechasPreview.length} turnos guardados`
          : "Turno guardado"
      )
      onSaved()
      onOpenChange(false)
    } catch (err) {
      console.error("[NuevoTurnoModal] save error:", err)
      toast.error(err instanceof Error ? err.message : "Error al guardar el turno")
    } finally {
      setIsSaving(false)
    }
  }

  return (
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
                {/* Weekday picker — Mon to Fri only */}
                <div className="flex gap-1.5">
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
                <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                  {fechasPreview.map((f, i) => (
                    <span key={i} className="bg-white border border-gray-200 rounded px-1.5 py-0.5 capitalize">
                      {format(f, "EEE d MMM", { locale: es })}
                    </span>
                  ))}
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
  )
}
