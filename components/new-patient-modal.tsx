"use client"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
import { ChevronDown, Plus, X } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { format } from "date-fns-tz"
import { db, auth } from "@/lib/firebase"
import { ref, push } from "firebase/database"
import { addToLibroDiario } from "@/lib/helpers"
import { Tratamiento } from "@/types"

interface NewPatientModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function getCurrentArgentinaDateTime() {
  return format(new Date(), "dd/MM/yyyy HH:mm", { timeZone: "America/Argentina/Buenos_Aires" })
}

function sessionBadgeClass(used: number, authorized: number): string {
  const ratio = used / authorized
  if (ratio >= 1) return "bg-red-50 text-red-700 border-red-200"
  if (ratio >= 0.8) return "bg-orange-50 text-orange-700 border-orange-200"
  return "bg-green-50 text-green-700 border-green-200"
}

const EMPTY_PATIENT = {
  nombre: "",
  apellido: "",
  sexo: "masculino",
  dni: "",
  edad: "",
  domicilio: "",
  obraSocial: "",
  nroAFL: "",
  telefono: "",
  diagnostico: "",
  doctor: "",
  anotaciones: "",
}

export function NewPatientModal({ open, onOpenChange }: NewPatientModalProps) {
  const [patient, setPatient] = useState(EMPTY_PATIENT)
  const [sesionesText, setSesionesText] = useState("")
  const [isSaving, setIsSaving] = useState(false)

  const [tratamientos, setTratamientos] = useState<Tratamiento[]>([])
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [showNewTreatmentForm, setShowNewTreatmentForm] = useState(false)
  const [newTreatmentNroAuth, setNewTreatmentNroAuth] = useState("")
  const [newTreatmentSesionesAuth, setNewTreatmentSesionesAuth] = useState("")

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleCreateTratamiento = () => {
    if (!newTreatmentSesionesAuth) return
    const id = `trat_${Date.now()}`
    const nuevo: Tratamiento = {
      id,
      nroAutorizacion: newTreatmentNroAuth.trim(),
      sesionesAutorizadas: parseInt(newTreatmentSesionesAuth, 10),
      fechaCreacion: new Date().toISOString(),
      sesiones: [],
    }
    setTratamientos((prev) => [...prev, nuevo])
    setExpandedIds((prev) => new Set([...prev, id]))
    setNewTreatmentNroAuth("")
    setNewTreatmentSesionesAuth("")
    setShowNewTreatmentForm(false)
  }

  const addSessionToTratamiento = (tratamientoId: string) => {
    const timestamp = getCurrentArgentinaDateTime()
    setTratamientos((prev) =>
      prev.map((t) => {
        if (t.id !== tratamientoId) return t
        const nextNum = t.sesiones.length + 1
        return { ...t, sesiones: [...t.sesiones, `Sesión ${nextNum} — ${timestamp}`] }
      })
    )
  }

  const removeSessionFromTratamiento = (tratamientoId: string, sessionIndex: number) => {
    setTratamientos((prev) =>
      prev.map((t) => {
        if (t.id !== tratamientoId) return t
        return { ...t, sesiones: t.sesiones.filter((_, i) => i !== sessionIndex) }
      })
    )
  }

  const resetForm = () => {
    setPatient(EMPTY_PATIENT)
    setSesionesText("")
    setTratamientos([])
    setExpandedIds(new Set())
    setShowNewTreatmentForm(false)
    setNewTreatmentNroAuth("")
    setNewTreatmentSesionesAuth("")
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSaving(true)
    try {
      const currentUser = auth.currentUser
      const latestTrat = tratamientos.length > 0 ? tratamientos[tratamientos.length - 1] : null

      await push(ref(db, "pacientes"), {
        ...patient,
        sesiones: sesionesText ? [sesionesText] : [],
        ...(tratamientos.length > 0 && { tratamientos }),
        ...(latestTrat && { sesionesAutorizadas: latestTrat.sesionesAutorizadas }),
        ...(latestTrat?.nroAutorizacion && { nroAutorizacion: latestTrat.nroAutorizacion }),
        ultima_actualizacion: {
          fecha: new Date().toISOString(),
          usuario: currentUser ? currentUser.displayName || currentUser.email : "Unknown",
        },
      })

      const hasSessions =
        sesionesText.trim() !== "" || tratamientos.some((t) => t.sesiones.length > 0)
      if (hasSessions) {
        await addToLibroDiario({
          nombreApellido: `${patient.nombre} ${patient.apellido}`,
          obraSocial: patient.obraSocial,
        })
      }

      toast.success("Paciente registrado correctamente")
      onOpenChange(false)
      resetForm()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error al registrar el paciente")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) resetForm(); onOpenChange(isOpen) }}>
      <DialogContent className="max-w-full sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Registrar nuevo paciente</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-6">

          {/* Datos personales */}
          <div className="space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Datos personales</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="nombre">Nombre</Label>
                <Input id="nombre" value={patient.nombre} onChange={(e) => setPatient({ ...patient, nombre: e.target.value })} required className="border-slate-200 focus:border-[#001633]" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="apellido">Apellido</Label>
                <Input id="apellido" value={patient.apellido} onChange={(e) => setPatient({ ...patient, apellido: e.target.value })} required className="border-slate-200 focus:border-[#001633]" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Sexo</Label>
              <RadioGroup value={patient.sexo} onValueChange={(value) => setPatient({ ...patient, sexo: value })} className="flex gap-4">
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="masculino" id="new-masculino" />
                  <Label htmlFor="new-masculino">Masculino</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="femenino" id="new-femenino" />
                  <Label htmlFor="new-femenino">Femenino</Label>
                </div>
              </RadioGroup>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="dni">DNI</Label>
                <Input id="dni" value={patient.dni} onChange={(e) => setPatient({ ...patient, dni: e.target.value })} required className="border-slate-200 focus:border-[#001633]" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edad">Edad</Label>
                <Input id="edad" value={patient.edad} onChange={(e) => setPatient({ ...patient, edad: e.target.value })} required className="border-slate-200 focus:border-[#001633]" />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="domicilio">Domicilio</Label>
              <Input id="domicilio" value={patient.domicilio} onChange={(e) => setPatient({ ...patient, domicilio: e.target.value })} className="border-slate-200 focus:border-[#001633]" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="telefono">Teléfono</Label>
              <Input id="telefono" value={patient.telefono} onChange={(e) => setPatient({ ...patient, telefono: e.target.value })} required className="border-slate-200 focus:border-[#001633]" />
            </div>
          </div>

          {/* Cobertura */}
          <div className="space-y-4 border-t border-slate-100 pt-5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Cobertura</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="obraSocial">Obra Social</Label>
                <Input id="obraSocial" value={patient.obraSocial} onChange={(e) => setPatient({ ...patient, obraSocial: e.target.value })} required className="border-slate-200 focus:border-[#001633]" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="nroAFL">N°AFL</Label>
                <Input id="nroAFL" value={patient.nroAFL} onChange={(e) => setPatient({ ...patient, nroAFL: e.target.value })} className="border-slate-200 focus:border-[#001633]" />
              </div>
            </div>
          </div>

          {/* Médico */}
          <div className="space-y-4 border-t border-slate-100 pt-5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Médico</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="diagnostico">Diagnóstico</Label>
                <Input id="diagnostico" value={patient.diagnostico} onChange={(e) => setPatient({ ...patient, diagnostico: e.target.value })} required className="border-slate-200 focus:border-[#001633]" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="doctor">Doctor</Label>
                <Input id="doctor" value={patient.doctor} onChange={(e) => setPatient({ ...patient, doctor: e.target.value })} required className="border-slate-200 focus:border-[#001633]" />
              </div>
            </div>
          </div>

          {/* Notas */}
          <div className="space-y-4 border-t border-slate-100 pt-5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Notas</h3>
            <div className="space-y-2">
              <Label htmlFor="anotaciones">Anotaciones</Label>
              <Textarea id="anotaciones" value={patient.anotaciones} onChange={(e) => setPatient({ ...patient, anotaciones: e.target.value })} className="min-h-[80px] border-slate-200 focus:border-[#001633]" />
            </div>
          </div>

          {/* Tratamientos */}
          <div className="space-y-4 border-t border-slate-100 pt-5">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Tratamientos</h3>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="flex items-center gap-1 text-xs border-[#001633] text-[#001633] hover:bg-[#001633] hover:text-white transition-colors"
                onClick={() => setShowNewTreatmentForm((v) => !v)}
              >
                <Plus className="h-3 w-3" />
                Nuevo tratamiento
              </Button>
            </div>

            {/* Formulario nuevo tratamiento */}
            {showNewTreatmentForm && (
              <div className="border border-blue-200 rounded-lg p-4 bg-blue-50/40 space-y-3">
                <p className="text-sm font-medium text-[#001633]">Nuevo tratamiento</p>
                <div className="flex items-end gap-3 flex-wrap">
                  <div className="space-y-1">
                    <Label className="text-xs text-gray-500">N° autorización</Label>
                    <Input
                      value={newTreatmentNroAuth}
                      onChange={(e) => setNewTreatmentNroAuth(e.target.value)}
                      placeholder="Código"
                      className="w-40 h-8 text-sm border-slate-200 focus:border-[#001633]"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-gray-500">Sesiones autorizadas</Label>
                    <Input
                      type="number"
                      min={1}
                      value={newTreatmentSesionesAuth}
                      onChange={(e) => setNewTreatmentSesionesAuth(e.target.value)}
                      placeholder="10"
                      className="w-28 h-8 text-sm border-slate-200 focus:border-[#001633]"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    className="h-7 text-xs bg-[#001633] hover:bg-[#002966]"
                    onClick={handleCreateTratamiento}
                    disabled={!newTreatmentSesionesAuth}
                  >
                    Crear
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setShowNewTreatmentForm(false)}
                  >
                    Cancelar
                  </Button>
                </div>
              </div>
            )}

            {/* Lista de tratamientos */}
            {tratamientos.length === 0 && !showNewTreatmentForm ? (
              <p className="text-sm text-gray-400">Sin tratamientos registrados</p>
            ) : (
              <div className="space-y-2">
                {tratamientos.map((trat, index) => {
                  const isExpanded = expandedIds.has(trat.id)
                  const usedCount = trat.sesiones.length

                  return (
                    <div key={trat.id} className="border border-gray-200 rounded-lg overflow-hidden">
                      {/* Header accordion */}
                      <button
                        type="button"
                        onClick={() => toggleExpanded(trat.id)}
                        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
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
                      </button>

                      {/* Contenido expandido */}
                      {isExpanded && (
                        <div className="px-4 py-3 space-y-2 border-t border-gray-100">
                          <div className="flex gap-4 flex-wrap items-start">
                            <div className="space-y-1">
                              <Label className="text-xs text-gray-500 whitespace-nowrap">N° autorización</Label>
                              <Input
                                value={trat.nroAutorizacion}
                                onChange={(e) =>
                                  setTratamientos((prev) =>
                                    prev.map((t) =>
                                      t.id === trat.id ? { ...t, nroAutorizacion: e.target.value } : t
                                    )
                                  )
                                }
                                placeholder="—"
                                className="h-7 text-sm w-44 border-slate-200 focus:border-[#001633]"
                              />
                            </div>
                            <div className="space-y-1 flex-1 min-w-[160px]">
                              <Label className="text-xs text-gray-500">Tratamiento</Label>
                              <Textarea
                                value={trat.tratamiento ?? ""}
                                onChange={(e) =>
                                  setTratamientos((prev) =>
                                    prev.map((t) =>
                                      t.id === trat.id ? { ...t, tratamiento: e.target.value } : t
                                    )
                                  )
                                }
                                className="min-h-[60px] text-sm border-slate-200 focus:border-[#001633]"
                              />
                            </div>
                          </div>
                          <p className="text-xs text-gray-400">
                            {trat.sesionesAutorizadas} sesiones autorizadas
                          </p>
                          {trat.sesiones.length === 0 ? (
                            <p className="text-sm text-gray-400">Sin sesiones registradas</p>
                          ) : (
                            <div className="space-y-1">
                              {trat.sesiones.map((s, si) => (
                                <div
                                  key={si}
                                  className="flex items-center justify-between px-3 py-1.5 rounded bg-white border border-gray-100 text-sm text-gray-700"
                                >
                                  <span>{s}</span>
                                  <button
                                    type="button"
                                    onClick={() => removeSessionFromTratamiento(trat.id, si)}
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
                            className="h-7 text-xs gap-1 border-[#001633] text-[#001633] hover:bg-[#001633] hover:text-white transition-colors"
                            onClick={() => addSessionToTratamiento(trat.id)}
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

          {/* Historial libre */}
          <div className="space-y-2 border-t border-slate-100 pt-5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Historial libre</h3>
            <Textarea
              value={sesionesText}
              onChange={(e) => setSesionesText(e.target.value)}
              className="min-h-[100px] border-slate-200 focus:border-[#001633] font-mono text-sm"
              placeholder="Ej: 1-28/3/23 2-30/3/23 3-3/4/23"
            />
          </div>

          <Button type="submit" className="w-auto bg-[#001633] hover:bg-[#002966] transition-colors" disabled={isSaving}>
            {isSaving ? "Registrando..." : "Registrar"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
