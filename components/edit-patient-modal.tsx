"use client"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
import { ChevronDown, MessageCircle, Plus, Trash2, X } from "lucide-react"
import { useState, useEffect } from "react"
import { format as formatTZ } from "date-fns-tz"
import { format, parseISO, isValid } from "date-fns"
import { es } from "date-fns/locale"
import { ref, remove, update } from "firebase/database"
import { auth, db } from "@/lib/firebase"
import { addToLibroDiario, fetchTurnosPorPaciente, parseTratamientosRaw, writeLog, LogCambio } from "@/lib/helpers"
import { Patient, Tratamiento, TurnoConFecha, TurnoEstado } from "@/types"
import { toast } from "sonner"
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

interface EditPatientModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  patient: Patient | null
  onSave: (updatedPatient: Patient) => void
  setLibroDiarioUpdateTrigger: (value: (prev: number) => number) => void
}

const ESTADO_CHIP: Record<TurnoEstado, string> = {
  pendiente: "bg-blue-50 text-blue-700 border-blue-200",
  asistio: "bg-green-50 text-green-700 border-green-200",
  ausente: "bg-red-50 text-red-700 border-red-200",
  cancelado: "bg-gray-50 text-gray-500 border-gray-200",
}

function getCurrentArgentinaDateTime() {
  return formatTZ(new Date(), "dd/MM/yyyy HH:mm", { timeZone: "America/Argentina/Buenos_Aires" })
}

function sessionBadgeClass(used: number, authorized: number): string {
  const ratio = used / authorized
  if (ratio >= 1) return "bg-red-50 text-red-700 border-red-200"
  if (ratio >= 0.8) return "bg-orange-50 text-orange-700 border-orange-200"
  return "bg-green-50 text-green-700 border-green-200"
}

function formatSesiones(text: string): string {
  return text.replace(/\s+(\d+-)/g, "\n$1").trim()
}

// Para diffs de textos largos en el log: muestra el final, que es donde se agregan sesiones
function resumirTexto(s: string, max = 120): string {
  const limpio = s.replace(/\n/g, " · ").trim()
  return limpio.length > max ? `…${limpio.slice(-max)}` : limpio || "—"
}

// Diff de tratamientos para el audit log: detecta altas, sesiones agregadas/quitadas/editadas
// y cambios de autorización/diagnóstico/doctor por tratamiento
function diffTratamientos(antes: Tratamiento[], despues: Tratamiento[], cambios: LogCambio) {
  const prevById = new Map(antes.map((t) => [t.id, t]))
  despues.forEach((t, i) => {
    const label = `Tratamiento ${i + 1}${t.nroAutorizacion ? ` (#${t.nroAutorizacion})` : ""}`
    const prev = prevById.get(t.id)
    if (!prev) {
      cambios[`${label} — nuevo`] = { antes: "—", despues: `${t.sesionesAutorizadas} sesiones autorizadas` }
      return
    }
    if (prev.sesionesAutorizadas !== t.sesionesAutorizadas) {
      cambios[`${label} — sesiones autorizadas`] = { antes: String(prev.sesionesAutorizadas), despues: String(t.sesionesAutorizadas) }
    }
    if (prev.sesiones.length !== t.sesiones.length) {
      cambios[`${label} — sesiones`] = { antes: `${prev.sesiones.length}`, despues: `${t.sesiones.length}` }
    } else if (JSON.stringify(prev.sesiones) !== JSON.stringify(t.sesiones)) {
      cambios[`${label} — sesiones`] = { antes: "—", despues: "texto de sesiones editado" }
    }
    const campos = [
      ["nroAutorizacion", "n° autorización"],
      ["diagnostico", "diagnóstico"],
      ["doctor", "doctor"],
      ["tratamiento", "descripción"],
    ] as const
    for (const [campo, lbl] of campos) {
      const a = String(prev[campo] ?? "")
      const d = String(t[campo] ?? "")
      if (a !== d) cambios[`${label} — ${lbl}`] = { antes: a || "—", despues: d || "—" }
    }
  })
  antes.forEach((t, i) => {
    if (!despues.some((d) => d.id === t.id)) {
      cambios[`Tratamiento ${i + 1}${t.nroAutorizacion ? ` (#${t.nroAutorizacion})` : ""}`] = {
        antes: `${t.sesiones.length}/${t.sesionesAutorizadas} sesiones`,
        despues: "eliminado",
      }
    }
  })
}


export function EditPatientModal({
  open,
  onOpenChange,
  patient,
  onSave,
  setLibroDiarioUpdateTrigger,
}: EditPatientModalProps) {
  const [editedPatient, setEditedPatient] = useState<Patient | null>(null)
  const [sesionesText, setSesionesText] = useState("")
  const [newSessionAdded, setNewSessionAdded] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [turnos, setTurnos] = useState<TurnoConFecha[]>([])
  const [isLoadingTurnos, setIsLoadingTurnos] = useState(false)
  const [confirmDeleteAllOpen, setConfirmDeleteAllOpen] = useState(false)

  const [tratamientos, setTratamientos] = useState<Tratamiento[]>([])
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [showNewTreatmentForm, setShowNewTreatmentForm] = useState(false)
  const [newTreatmentNroAuth, setNewTreatmentNroAuth] = useState("")
  const [newTreatmentSesionesAuth, setNewTreatmentSesionesAuth] = useState("")
  const [newTreatmentDiagnostico, setNewTreatmentDiagnostico] = useState("")
  const [newTreatmentDoctor, setNewTreatmentDoctor] = useState("")

  useEffect(() => {
    if (!patient) return
    setEditedPatient(patient)
    setSesionesText(formatSesiones((patient.sesiones ?? []).join(" ")))
    setNewSessionAdded(false)
    setShowNewTreatmentForm(false)
    setNewTreatmentNroAuth("")
    setNewTreatmentSesionesAuth("")
    setNewTreatmentDiagnostico("")
    setNewTreatmentDoctor("")

    const loaded = parseTratamientosRaw(patient.tratamientos)
    setTratamientos(loaded)
    setExpandedIds(loaded.length > 0 ? new Set([loaded[loaded.length - 1].id]) : new Set())

    setIsLoadingTurnos(true)
    fetchTurnosPorPaciente(patient.id)
      .then(setTurnos)
      .catch(() => setTurnos([]))
      .finally(() => setIsLoadingTurnos(false))
  }, [patient])

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
      ...(newTreatmentDiagnostico.trim() && { diagnostico: newTreatmentDiagnostico.trim() }),
      ...(newTreatmentDoctor.trim() && { doctor: newTreatmentDoctor.trim() }),
    }
    setTratamientos((prev) => [...prev, nuevo])
    setExpandedIds((prev) => new Set([...prev, id]))
    setNewTreatmentNroAuth("")
    setNewTreatmentSesionesAuth("")
    setNewTreatmentDiagnostico("")
    setNewTreatmentDoctor("")
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
    setNewSessionAdded(true)
  }

  const removeSessionFromTratamiento = (tratamientoId: string, sessionIndex: number) => {
    setTratamientos((prev) =>
      prev.map((t) => {
        if (t.id !== tratamientoId) return t
        return { ...t, sesiones: t.sesiones.filter((_, i) => i !== sessionIndex) }
      })
    )
  }

  const updateSessionInTratamiento = (tratamientoId: string, sessionIndex: number, value: string) => {
    setTratamientos((prev) =>
      prev.map((t) => {
        if (t.id !== tratamientoId) return t
        const newSesiones = [...t.sesiones]
        newSesiones[sessionIndex] = value
        return { ...t, sesiones: newSesiones }
      })
    )
  }

  // "Hoy" en hora argentina (no UTC): después de las 21:00 el día UTC ya es mañana
  const hoyKey = formatTZ(new Date(), "yyyy-MM-dd", { timeZone: "America/Argentina/Buenos_Aires" })
  const turnosFuturos = turnos.filter((t) => t.fecha >= hoyKey)
  const pasadosPendientes = turnos.filter((t) => t.fecha < hoyKey && t.estado === "pendiente")
  const pasadosCount = turnos.length - turnosFuturos.length

  const handleDeleteTurno = async (turno: TurnoConFecha) => {
    try {
      await remove(ref(db, `turnos/${turno.fecha}/${turno.id}`))
      setTurnos((prev) => prev.filter((t) => t.id !== turno.id))
      toast.success("Turno eliminado")
      await writeLog({ accion: "eliminar_turno", detalle: `Eliminó turno de ${turno.nombre} ${turno.apellido} (${turno.fecha} ${turno.hora})`, entidadId: turno.id })
    } catch {
      toast.error("Error al eliminar el turno")
    }
  }

  // Elimina solo los turnos desde hoy en adelante; los previos quedan como registro
  // (los pendientes pasados se marcan cancelados). Una sola escritura multi-path.
  const handleDeleteAllTurnos = async () => {
    const nombrePaciente = `${editedPatient?.nombre ?? ""} ${editedPatient?.apellido ?? ""}`.trim()
    const turnosPrevios = turnos
    try {
      const updates: Record<string, unknown> = {}
      const revert: Record<string, unknown> = {}

      for (const t of turnosFuturos) {
        updates[`turnos/${t.fecha}/${t.id}`] = null
        // Nodo completo para poder restaurar con "Deshacer" (sin id/fecha ni undefined)
        const { id: _id, fecha: _fecha, ...nodo } = t
        revert[`turnos/${t.fecha}/${t.id}`] = Object.fromEntries(
          Object.entries(nodo).filter(([, v]) => v !== undefined)
        )
      }
      for (const t of pasadosPendientes) {
        updates[`turnos/${t.fecha}/${t.id}/estado`] = "cancelado"
        revert[`turnos/${t.fecha}/${t.id}/estado`] = "pendiente"
      }
      if (Object.keys(updates).length === 0) return

      await update(ref(db), updates)

      setTurnos(
        turnosPrevios
          .filter((t) => t.fecha < hoyKey)
          .map((t) => (t.estado === "pendiente" ? { ...t, estado: "cancelado" as TurnoEstado } : t))
      )

      const partes: string[] = []
      if (turnosFuturos.length > 0)
        partes.push(`${turnosFuturos.length} turno${turnosFuturos.length !== 1 ? "s" : ""} eliminado${turnosFuturos.length !== 1 ? "s" : ""} desde hoy`)
      if (pasadosPendientes.length > 0)
        partes.push(`${pasadosPendientes.length} previo${pasadosPendientes.length !== 1 ? "s" : ""} cancelado${pasadosPendientes.length !== 1 ? "s" : ""}`)

      toast.success(partes.join(" · "), {
        duration: 8000,
        action: {
          label: "Deshacer",
          onClick: async () => {
            try {
              await update(ref(db), revert)
              setTurnos(turnosPrevios)
              toast.success("Turnos restaurados")
              await writeLog({
                accion: "deshacer_eliminar_turnos",
                detalle: `Restauró ${turnosFuturos.length} turno${turnosFuturos.length !== 1 ? "s" : ""} de ${nombrePaciente}`,
              })
            } catch {
              toast.error("No se pudieron restaurar los turnos")
            }
          },
        },
      })

      await writeLog({
        accion: "eliminar_todos_turnos",
        detalle: `Eliminó ${turnosFuturos.length} turno${turnosFuturos.length !== 1 ? "s" : ""} desde hoy de ${nombrePaciente}${
          pasadosPendientes.length > 0
            ? ` y marcó ${pasadosPendientes.length} turno${pasadosPendientes.length !== 1 ? "s" : ""} previo${pasadosPendientes.length !== 1 ? "s" : ""} como cancelado`
            : ""
        }`,
      })
    } catch {
      toast.error("Error al eliminar los turnos")
    }
  }

  const handleSave = async () => {
    if (!editedPatient) return
    setIsSaving(true)
    try {
      const latestTrat = tratamientos.length > 0 ? tratamientos[tratamientos.length - 1] : null
      const updatedPatient: Patient = {
        ...editedPatient,
        tratamientos,
        sesiones: sesionesText ? [sesionesText] : [],
        sesionesAutorizadas: latestTrat?.sesionesAutorizadas ?? editedPatient.sesionesAutorizadas,
        nroAutorizacion: latestTrat?.nroAutorizacion || editedPatient.nroAutorizacion,
        diagnostico: latestTrat?.diagnostico || editedPatient.diagnostico,
        doctor: latestTrat?.doctor || editedPatient.doctor,
        ultima_actualizacion: {
          fecha: new Date().toISOString(),
          usuario: auth.currentUser?.displayName || auth.currentUser?.email || "Unknown",
        },
      }

      if (newSessionAdded) {
        await addToLibroDiario({
          nombreApellido: `${updatedPatient.nombre} ${updatedPatient.apellido}`,
          obraSocial: updatedPatient.obraSocial,
        })
      }

      const CAMPOS_LABEL: Partial<Record<keyof Patient, string>> = {
        nombre: "Nombre", apellido: "Apellido", edad: "Edad", dni: "DNI",
        obraSocial: "Obra Social", nroAFL: "N°AFL", telefono: "Teléfono",
        domicilio: "Domicilio", anotaciones: "Anotaciones", sexo: "Sexo",
      }
      const cambios: LogCambio = {}
      for (const campo of Object.keys(CAMPOS_LABEL) as (keyof Patient)[]) {
        const antes = String(patient?.[campo] ?? "")
        const despues = String(updatedPatient[campo] ?? "")
        if (antes !== despues) cambios[CAMPOS_LABEL[campo]!] = { antes, despues }
      }

      // Diff del historial libre y de los tratamientos (sesiones, autorizaciones, etc.)
      const historialInicial = formatSesiones((patient?.sesiones ?? []).join(" "))
      if (historialInicial !== sesionesText.trim()) {
        cambios["Historial"] = { antes: resumirTexto(historialInicial), despues: resumirTexto(sesionesText) }
      }
      diffTratamientos(parseTratamientosRaw(patient?.tratamientos), tratamientos, cambios)

      // Sin cambios reales → no ensuciar el audit log
      if (Object.keys(cambios).length > 0) {
        await writeLog({ accion: "editar_paciente", detalle: `Editó paciente ${updatedPatient.nombre} ${updatedPatient.apellido}`, entidadId: updatedPatient.id, cambios })
      }
      onSave(updatedPatient)
      setNewSessionAdded(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error al guardar los cambios")
    } finally {
      setIsSaving(false)
    }
  }

  const handleWhatsApp = () => {
    if (!editedPatient) return
    const raw = editedPatient.telefono.replace(/\D/g, "")
    const phone = raw.startsWith("54") ? raw : raw.startsWith("0") ? `54${raw.slice(1)}` : `54${raw}`

    const pendientes = turnos
      .filter((t) => t.estado === "pendiente")
      .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.hora.localeCompare(b.hora))

    const lineas = pendientes.map((t) => {
      const d = parseISO(t.fecha)
      const label = isValid(d) ? format(d, "EEEE d 'de' MMMM", { locale: es }) : t.fecha
      return `• ${label.charAt(0).toUpperCase() + label.slice(1)} a las ${t.hora}`
    })

    const mensaje =
      `Hola ${editedPatient.nombre}, te recordamos tus turnos agendados:\n\n` +
      (lineas.length > 0 ? lineas.join("\n") : "No tenés turnos pendientes por el momento.") +
      "\n\n*Kinesiología Integral*\nLic. Ana Patricia Tullio\n📞 02320-659087"

    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(mensaje)}`, "_blank")
  }

  if (!editedPatient) return null


  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-full sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar — {editedPatient.nombre} {editedPatient.apellido}</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-6"
            onSubmit={(e) => {
              e.preventDefault()
              handleSave()
            }}
          >
            {/* Datos personales */}
            <div className="space-y-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Datos personales</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="nombre">Nombre</Label>
                  <Input id="nombre" value={editedPatient.nombre} onChange={(e) => setEditedPatient({ ...editedPatient, nombre: e.target.value })} className="border-slate-200 focus:border-[#001633]" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="apellido">Apellido</Label>
                  <Input id="apellido" value={editedPatient.apellido} onChange={(e) => setEditedPatient({ ...editedPatient, apellido: e.target.value })} className="border-slate-200 focus:border-[#001633]" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Sexo</Label>
                <RadioGroup value={editedPatient.sexo || ""} onValueChange={(value) => setEditedPatient({ ...editedPatient, sexo: value })} className="flex gap-4">
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="masculino" id="masculino" />
                    <Label htmlFor="masculino">Masculino</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="femenino" id="femenino" />
                    <Label htmlFor="femenino">Femenino</Label>
                  </div>
                </RadioGroup>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="dni">DNI</Label>
                  <Input id="dni" value={editedPatient.dni} onChange={(e) => setEditedPatient({ ...editedPatient, dni: e.target.value })} className="border-slate-200 focus:border-[#001633]" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edad">Edad</Label>
                  <Input id="edad" value={editedPatient.edad} onChange={(e) => setEditedPatient({ ...editedPatient, edad: e.target.value })} className="border-slate-200 focus:border-[#001633]" />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="domicilio">Domicilio</Label>
                <Input id="domicilio" value={editedPatient.domicilio || ""} onChange={(e) => setEditedPatient({ ...editedPatient, domicilio: e.target.value })} className="border-slate-200 focus:border-[#001633]" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="telefono">Teléfono</Label>
                <Input id="telefono" value={editedPatient.telefono} onChange={(e) => setEditedPatient({ ...editedPatient, telefono: e.target.value })} className="border-slate-200 focus:border-[#001633]" />
              </div>
            </div>

            {/* Cobertura */}
            <div className="space-y-4 border-t border-slate-100 pt-5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Cobertura</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="obra-social">Obra Social</Label>
                  <Input id="obra-social" value={editedPatient.obraSocial} onChange={(e) => setEditedPatient({ ...editedPatient, obraSocial: e.target.value })} className="border-slate-200 focus:border-[#001633]" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="afl">N°AFL</Label>
                  <Input id="afl" value={editedPatient.nroAFL} onChange={(e) => setEditedPatient({ ...editedPatient, nroAFL: e.target.value })} className="border-slate-200 focus:border-[#001633]" />
                </div>
              </div>
            </div>

            {/* Notas */}
            <div className="space-y-4 border-t border-slate-100 pt-5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Notas</h3>
              <div className="space-y-2">
                <Label htmlFor="anotaciones">Anotaciones</Label>
                <Textarea id="anotaciones" value={editedPatient.anotaciones || ""} onChange={(e) => setEditedPatient({ ...editedPatient, anotaciones: e.target.value })} className="min-h-[80px] border-slate-200 focus:border-[#001633]" />
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-gray-500">Diagnóstico</Label>
                      <Input
                        value={newTreatmentDiagnostico}
                        onChange={(e) => setNewTreatmentDiagnostico(e.target.value)}
                        placeholder="Ej: Lumbalgia"
                        className="h-8 text-sm border-slate-200 focus:border-[#001633]"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-gray-500">Doctor</Label>
                      <Input
                        value={newTreatmentDoctor}
                        onChange={(e) => setNewTreatmentDoctor(e.target.value)}
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
                    const fechaDate = new Date(trat.fechaCreacion)
                    const fechaLabel = isValid(fechaDate) ? format(fechaDate, "dd/MM/yyyy") : ""

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
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <div className="space-y-1">
                                <Label className="text-xs text-gray-500">Diagnóstico</Label>
                                <Input
                                  value={trat.diagnostico ?? ""}
                                  onChange={(e) =>
                                    setTratamientos((prev) =>
                                      prev.map((t) =>
                                        t.id === trat.id ? { ...t, diagnostico: e.target.value } : t
                                      )
                                    )
                                  }
                                  placeholder="—"
                                  className="h-7 text-sm border-slate-200 focus:border-[#001633]"
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs text-gray-500">Doctor</Label>
                                <Input
                                  value={trat.doctor ?? ""}
                                  onChange={(e) =>
                                    setTratamientos((prev) =>
                                      prev.map((t) =>
                                        t.id === trat.id ? { ...t, doctor: e.target.value } : t
                                      )
                                    )
                                  }
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
                                  setTratamientos((prev) =>
                                    prev.map((t) =>
                                      t.id === trat.id
                                        ? { ...t, sesionesAutorizadas: parseInt(e.target.value, 10) || 0 }
                                        : t
                                    )
                                  )
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
                                      onChange={(e) => updateSessionInTratamiento(trat.id, si, e.target.value)}
                                      className="flex-1 bg-transparent text-sm text-gray-700 outline-none border-b border-transparent focus:border-slate-300 transition-colors min-w-0"
                                    />
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

            {/* Turnos agendados */}
            <div className="space-y-4 border-t border-slate-100 pt-5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Turnos agendados</h3>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-500">
                  {turnos.length > 0 ? `${turnos.length} turno${turnos.length !== 1 ? "s" : ""}` : ""}
                </span>
                <div className="flex items-center gap-2">
                  {editedPatient.telefono && !isLoadingTurnos && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="text-xs h-7 gap-1.5 border-green-300 text-green-700 hover:bg-green-50"
                      onClick={handleWhatsApp}
                    >
                      <MessageCircle className="h-3.5 w-3.5" />
                      WhatsApp
                    </Button>
                  )}
                  {(turnosFuturos.length > 0 || pasadosPendientes.length > 0) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-xs text-red-500 hover:text-red-700 h-7"
                      onClick={() => setConfirmDeleteAllOpen(true)}
                    >
                      Eliminar próximos
                    </Button>
                  )}
                </div>
              </div>

              {isLoadingTurnos ? (
                <p className="text-sm text-gray-400">Cargando...</p>
              ) : turnos.length === 0 ? (
                <p className="text-sm text-gray-400">Sin turnos agendados</p>
              ) : (
                <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                  {turnos.map((t) => {
                    const fechaDate = parseISO(t.fecha)
                    const fechaLabel = isValid(fechaDate) ? format(fechaDate, "EEE d 'de' MMM", { locale: es }) : t.fecha
                    return (
                      <div
                        key={`${t.fecha}-${t.id}`}
                        className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-md border border-gray-100 text-sm"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="text-gray-500 text-xs capitalize shrink-0">{fechaLabel}</span>
                          <span className="font-medium shrink-0">{t.hora}</span>
                          <span className={`text-xs px-1.5 py-0.5 rounded border shrink-0 ${ESTADO_CHIP[t.estado]}`}>
                            {t.estado === "asistio" ? "asistió" : t.estado}
                            {t.estado === "ausente" && t.justificado != null && (
                              <span className="ml-1 opacity-70">
                                {t.justificado ? "· just." : "· no just."}
                              </span>
                            )}
                          </span>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-red-400 hover:text-red-600 hover:bg-red-50 shrink-0"
                          onClick={() => handleDeleteTurno(t)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <Button
              type="submit"
              className="w-auto bg-[#001633] hover:bg-[#002966] transition-colors"
              disabled={isSaving}
            >
              {isSaving ? "Guardando..." : "Guardar Cambios"}
            </Button>

            <div className="text-sm text-slate-400 mt-2">
              Última actualización: {editedPatient.ultima_actualizacion?.usuario || "N/A"} —{" "}
              {editedPatient.ultima_actualizacion?.fecha
                ? (() => {
                    const d = new Date(editedPatient.ultima_actualizacion!.fecha)
                    return isValid(d)
                      ? formatTZ(d, "dd/MM/yyyy HH:mm", { timeZone: "America/Argentina/Buenos_Aires" })
                      : editedPatient.ultima_actualizacion!.fecha
                  })()
                : "N/A"}
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDeleteAllOpen} onOpenChange={setConfirmDeleteAllOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar los turnos próximos?</AlertDialogTitle>
            <AlertDialogDescription>
              {turnosFuturos.length > 0
                ? `Se eliminarán ${turnosFuturos.length} turno${turnosFuturos.length !== 1 ? "s" : ""} desde hoy en adelante de ${editedPatient?.nombre} ${editedPatient?.apellido}. `
                : `${editedPatient?.nombre} ${editedPatient?.apellido} no tiene turnos próximos. `}
              {pasadosCount > 0 && (
                <>
                  Los {pasadosCount} turno{pasadosCount !== 1 ? "s" : ""} anteriores quedan registrados
                  {pasadosPendientes.length > 0 && (
                    <> ({pasadosPendientes.length} pendiente{pasadosPendientes.length !== 1 ? "s" : ""} pasará{pasadosPendientes.length !== 1 ? "n" : ""} a cancelado)</>
                  )}
                  .
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteAllTurnos} className="bg-red-600 hover:bg-red-700">
              Eliminar próximos
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
