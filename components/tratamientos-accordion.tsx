"use client"

import { useMemo, useState } from "react"
import { format, isValid } from "date-fns"
import { format as formatTZ } from "date-fns-tz"
import { ChevronDown, Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Tratamiento } from "@/types"
import { usePatients } from "@/lib/patients-store"
import { sugerenciasDoctores } from "@/lib/doctores"

// Autocompletado de médico: input + dropdown propio (mismo look que el buscador de
// pacientes) con teclado (↑↓/Enter/Esc). Permite texto libre (cargar un médico
// nuevo) y sugiere los existentes ya fusionados. Sin dependencias ni lecturas extra.
function DoctorAutocomplete({
  value,
  onChange,
  sugerencias,
  placeholder,
  className,
}: {
  value: string
  onChange: (v: string) => void
  sugerencias: string[]
  placeholder?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(-1)

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase()
    const base = q
      ? sugerencias.filter((s) => s.toLowerCase().includes(q) && s.toLowerCase() !== q)
      : sugerencias
    return base.slice(0, 8)
  }, [value, sugerencias])

  const pick = (s: string) => {
    onChange(s)
    setOpen(false)
    setHighlight(-1)
  }

  return (
    <div className="relative">
      <Input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setHighlight(-1) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            if (!open) { setOpen(true); return }
            e.preventDefault()
            setHighlight((h) => Math.min(h + 1, filtered.length - 1))
          } else if (e.key === "ArrowUp") {
            e.preventDefault()
            setHighlight((h) => Math.max(h - 1, 0))
          } else if (e.key === "Enter") {
            if (open && highlight >= 0 && filtered[highlight]) { e.preventDefault(); pick(filtered[highlight]) }
          } else if (e.key === "Escape") {
            setOpen(false)
          }
        }}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        className={className}
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-52 overflow-y-auto">
          {filtered.map((s, i) => (
            <button
              key={s}
              type="button"
              className={`w-full text-left px-3 py-2 text-sm transition-colors ${i === highlight ? "bg-[#001633]/5 text-[#001633]" : "hover:bg-gray-50"}`}
              onMouseDown={(e) => { e.preventDefault(); pick(s) }}
              onMouseEnter={() => setHighlight(i)}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function getCurrentArgentinaDateTime() {
  return formatTZ(new Date(), "dd/MM/yyyy HH:mm", { timeZone: "America/Argentina/Buenos_Aires" })
}

export function sessionBadgeClass(used: number, authorized: number): string {
  const ratio = used / authorized
  if (ratio >= 1) return "bg-red-50 text-red-700 border-red-200"
  if (ratio >= 0.8) return "bg-orange-50 text-orange-700 border-orange-200"
  return "bg-green-50 text-green-700 border-green-200"
}

interface TratamientosAccordionProps {
  /** Lista controlada por el padre (la necesita al guardar) */
  tratamientos: Tratamiento[]
  onChange: (next: Tratamiento[]) => void
  /** Se llama al agregar una sesión manual, con su fecha/hora ("dd/MM/yyyy HH:mm") —
   *  el padre la registra también en el historial libre para que todo quede en un lugar */
  onSessionAdded?: (fechaHora: string) => void
}

// Sección "Tratamientos" completa: alta de tratamiento + acordeón editable de
// sesiones/autorización/diagnóstico/doctor. Compartida entre crear y editar paciente.
export function TratamientosAccordion({ tratamientos, onChange, onSessionAdded }: TratamientosAccordionProps) {
  // El último tratamiento arranca expandido (es el activo)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() =>
    tratamientos.length > 0 ? new Set([tratamientos[tratamientos.length - 1].id]) : new Set()
  )
  const [showNewForm, setShowNewForm] = useState(false)
  const [newNroAuth, setNewNroAuth] = useState("")
  const [newSesionesAuth, setNewSesionesAuth] = useState("")
  const [newDiagnostico, setNewDiagnostico] = useState("")
  const [newDoctor, setNewDoctor] = useState("")

  // Médicos ya cargados en toda la base (caché live → sin lecturas nuevas), para
  // autocompletar y evitar variantes de tipeo del mismo derivante.
  const { patients } = usePatients()
  const doctoresSugeridos = useMemo(() => sugerenciasDoctores(patients), [patients])

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const updateTrat = (id: string, patch: Partial<Tratamiento>) =>
    onChange(tratamientos.map((t) => (t.id === id ? { ...t, ...patch } : t)))

  const handleCreate = () => {
    if (!newSesionesAuth) return
    const id = `trat_${Date.now()}`
    const nuevo: Tratamiento = {
      id,
      nroAutorizacion: newNroAuth.trim(),
      sesionesAutorizadas: parseInt(newSesionesAuth, 10),
      fechaCreacion: new Date().toISOString(),
      sesiones: [],
      ...(newDiagnostico.trim() && { diagnostico: newDiagnostico.trim() }),
      ...(newDoctor.trim() && { doctor: newDoctor.trim() }),
    }
    onChange([...tratamientos, nuevo])
    setExpandedIds((prev) => new Set([...prev, id]))
    setNewNroAuth("")
    setNewSesionesAuth("")
    setNewDiagnostico("")
    setNewDoctor("")
    setShowNewForm(false)
  }

  const addSession = (id: string) => {
    const trat = tratamientos.find((t) => t.id === id)
    if (!trat) return
    const fechaHora = getCurrentArgentinaDateTime()
    updateTrat(id, { sesiones: [...trat.sesiones, `Sesión ${trat.sesiones.length + 1} — ${fechaHora}`] })
    onSessionAdded?.(fechaHora)
  }

  const removeSession = (id: string, index: number) => {
    const trat = tratamientos.find((t) => t.id === id)
    if (!trat) return
    updateTrat(id, { sesiones: trat.sesiones.filter((_, i) => i !== index) })
  }

  const updateSession = (id: string, index: number, value: string) => {
    const trat = tratamientos.find((t) => t.id === id)
    if (!trat) return
    const sesiones = [...trat.sesiones]
    sesiones[index] = value
    updateTrat(id, { sesiones })
  }

  return (
    <div className="space-y-4 border-t border-slate-100 pt-5">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Tratamientos</h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="flex items-center gap-1 text-xs border-[#001633] text-[#001633] hover:bg-[#001633] hover:text-white"
          onClick={() => setShowNewForm((v) => !v)}
        >
          <Plus className="h-3 w-3" />
          Nuevo tratamiento
        </Button>
      </div>

      {/* Formulario nuevo tratamiento */}
      {showNewForm && (
        <div className="border border-blue-200 rounded-lg p-4 bg-blue-50/40 space-y-3">
          <p className="text-sm font-medium text-[#001633]">Nuevo tratamiento</p>
          <div className="flex items-end gap-3 flex-wrap">
            <div className="space-y-1">
              <Label className="text-xs text-gray-500">N° autorización</Label>
              <Input
                value={newNroAuth}
                onChange={(e) => setNewNroAuth(e.target.value)}
                placeholder="Código"
                className="w-40 h-8 text-sm border-slate-200 focus:border-[#001633]"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-gray-500">Sesiones autorizadas</Label>
              <Input
                type="number"
                min={1}
                value={newSesionesAuth}
                onChange={(e) => setNewSesionesAuth(e.target.value)}
                placeholder="10"
                className="w-28 h-8 text-sm border-slate-200 focus:border-[#001633]"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-gray-500">Diagnóstico</Label>
              <Input
                value={newDiagnostico}
                onChange={(e) => setNewDiagnostico(e.target.value)}
                placeholder="Ej: Lumbalgia"
                className="h-8 text-sm border-slate-200 focus:border-[#001633]"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-gray-500">Doctor</Label>
              <DoctorAutocomplete
                value={newDoctor}
                onChange={setNewDoctor}
                sugerencias={doctoresSugeridos}
                placeholder="Nombre del médico"
                className="h-8 text-sm border-slate-200 focus:border-[#001633]"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              className="h-7 text-xs bg-[#001633] hover:bg-[#002966]"
              onClick={handleCreate}
              disabled={!newSesionesAuth}
            >
              Crear
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setShowNewForm(false)}
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {/* Lista de tratamientos */}
      {tratamientos.length === 0 && !showNewForm ? (
        <p className="text-sm text-gray-400">Sin tratamientos registrados</p>
      ) : (
        <div className="space-y-2">
          {tratamientos.map((trat, index) => {
            const isExpanded = expandedIds.has(trat.id)
            const usedCount = trat.sesiones.length
            const fechaDate = new Date(trat.fechaCreacion)
            const fechaLabel = isValid(fechaDate) ? format(fechaDate, "dd/MM/yyyy") : ""

            return (
              <div key={trat.id} className="border border-gray-200 rounded-lg">
                {/* Header accordion */}
                <button
                  type="button"
                  onClick={() => toggleExpanded(trat.id)}
                  className={`w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left ${isExpanded ? "rounded-t-lg" : "rounded-lg"}`}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <ChevronDown
                      className={`h-4 w-4 text-gray-400 transition-transform duration-150 ${isExpanded ? "" : "-rotate-90"}`}
                    />
                    <span className="font-medium text-sm text-gray-800">
                      {trat.nroAutorizacion
                        ? `Autorización #${trat.nroAutorizacion}`
                        : `Tratamiento ${index + 1}`}
                    </span>
                    <span
                      className={`text-[11px] px-1.5 py-0.5 rounded-full border font-medium ${sessionBadgeClass(usedCount, trat.sesionesAutorizadas)}`}
                    >
                      {usedCount}/{trat.sesionesAutorizadas} sesiones
                    </span>
                  </div>
                  {fechaLabel && (
                    <span className="text-xs text-gray-400 shrink-0 ml-2">{fechaLabel}</span>
                  )}
                </button>

                {/* Contenido expandido */}
                {isExpanded && (
                  <div className="px-4 py-3 space-y-2 border-t border-gray-100">
                    <div className="flex gap-4 flex-wrap items-start">
                      <div className="space-y-1">
                        <Label className="text-xs text-gray-500 whitespace-nowrap">N° autorización</Label>
                        <Input
                          value={trat.nroAutorizacion}
                          onChange={(e) => updateTrat(trat.id, { nroAutorizacion: e.target.value })}
                          placeholder="—"
                          className="h-7 text-sm w-44 border-slate-200 focus:border-[#001633]"
                        />
                      </div>
                      <div className="space-y-1 flex-1 min-w-[160px]">
                        <Label className="text-xs text-gray-500">Tratamiento</Label>
                        <Textarea
                          value={trat.tratamiento ?? ""}
                          onChange={(e) => updateTrat(trat.id, { tratamiento: e.target.value })}
                          className="min-h-[60px] text-sm border-slate-200 focus:border-[#001633]"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs text-gray-500">Diagnóstico</Label>
                        <Input
                          value={trat.diagnostico ?? ""}
                          onChange={(e) => updateTrat(trat.id, { diagnostico: e.target.value })}
                          placeholder="—"
                          className="h-7 text-sm border-slate-200 focus:border-[#001633]"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-gray-500">Doctor</Label>
                        <DoctorAutocomplete
                          value={trat.doctor ?? ""}
                          onChange={(v) => updateTrat(trat.id, { doctor: v })}
                          sugerencias={doctoresSugeridos}
                          placeholder="—"
                          className="h-7 text-sm border-slate-200 focus:border-[#001633]"
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-gray-500">Sesiones autorizadas</Label>
                      <Input
                        type="number"
                        min={1}
                        value={trat.sesionesAutorizadas}
                        onChange={(e) =>
                          updateTrat(trat.id, { sesionesAutorizadas: parseInt(e.target.value, 10) || 0 })
                        }
                        className="h-7 text-sm w-24 border-slate-200 focus:border-[#001633]"
                      />
                    </div>
                    {trat.sesiones.length === 0 ? (
                      <p className="text-sm text-gray-400">Sin sesiones registradas</p>
                    ) : (
                      <div className="space-y-1">
                        {trat.sesiones.map((s, si) => (
                          <div
                            key={si}
                            className="flex items-center justify-between px-3 py-1.5 rounded bg-white border border-gray-100 text-sm text-gray-700"
                          >
                            <input
                              type="text"
                              value={s}
                              onChange={(e) => updateSession(trat.id, si, e.target.value)}
                              className="flex-1 bg-transparent text-sm text-gray-700 outline-none border-b border-transparent focus:border-slate-300 transition-colors min-w-0"
                            />
                            <button
                              type="button"
                              onClick={() => removeSession(trat.id, si)}
                              className="text-gray-300 hover:text-red-500 transition-colors ml-3 shrink-0"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1 border-[#001633] text-[#001633] hover:bg-[#001633] hover:text-white"
                      onClick={() => addSession(trat.id)}
                    >
                      <Plus className="h-3 w-3" />
                      Nueva sesión
                    </Button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
