"use client"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
import { MessageCircle, Plus, Trash2 } from "lucide-react"
import { useState, useEffect } from "react"
import { format as formatTZ } from "date-fns-tz"
import { format, parseISO, isValid } from "date-fns"
import { es } from "date-fns/locale"
import { ref, remove, get } from "firebase/database"
import { auth, db } from "@/lib/firebase"
import { addToLibroDiario, fetchTurnosPorPaciente } from "@/lib/helpers"
import { Patient, TurnoConFecha, TurnoEstado } from "@/types"
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

function getNextSessionNumber(text: string): number {
  const matches = [...text.matchAll(/(\d+)-/g)]
  if (matches.length === 0) return 1
  const numbers = matches.map(m => parseInt(m[1], 10))
  return Math.max(...numbers) + 1
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

// Inserta salto de línea antes de cada entrada de sesión (N-)
function formatSesiones(text: string): string {
  return text.replace(/\s+(\d+-)/g, '\n$1').trim()
}

function countSessions(text: string): number {
  return [...text.matchAll(/\d+-/g)].length
}

function sessionCountColor(used: number, authorized: number | undefined): string {
  if (!authorized) return "text-gray-500"
  const ratio = used / authorized
  if (ratio >= 1) return "text-red-600 font-medium"
  if (ratio >= 0.8) return "text-orange-500 font-medium"
  return "text-gray-500"
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

  useEffect(() => {
    if (!patient) return
    setEditedPatient(patient)
    setSesionesText(
      Array.isArray(patient.sesiones) ? formatSesiones(patient.sesiones.join(" ")) : ""
    )
    setIsLoadingTurnos(true)
    Promise.all([
      get(ref(db, `pacientes/${patient.id}/sesiones`)),
      fetchTurnosPorPaciente(patient.id),
    ])
      .then(([sesionesSnap, fetchedTurnos]) => {
        if (sesionesSnap.exists()) {
          const fresh = sesionesSnap.val()
          const arr = Array.isArray(fresh) ? fresh : typeof fresh === "string" ? [fresh] : []
          setSesionesText(formatSesiones(arr.join(" ")))
          setEditedPatient(prev => prev ? { ...prev, sesiones: arr } : null)
        }
        setTurnos(fetchedTurnos)
      })
      .catch(() => setTurnos([]))
      .finally(() => setIsLoadingTurnos(false))
  }, [patient])

  const handleDeleteTurno = async (turno: TurnoConFecha) => {
    try {
      await remove(ref(db, `turnos/${turno.fecha}/${turno.id}`))
      setTurnos((prev) => prev.filter((t) => t.id !== turno.id))
      toast.success("Turno eliminado")
    } catch {
      toast.error("Error al eliminar el turno")
    }
  }

  const handleDeleteAllTurnos = async () => {
    try {
      await Promise.all(turnos.map((t) => remove(ref(db, `turnos/${t.fecha}/${t.id}`))))
      setTurnos([])
      toast.success(`${turnos.length} turno${turnos.length !== 1 ? "s" : ""} eliminados`)
    } catch {
      toast.error("Error al eliminar los turnos")
    }
  }

  const addSession = () => {
    const newEntry = `${getNextSessionNumber(sesionesText)}- ${getCurrentArgentinaDateTime()}`
    setSesionesText(prev => prev.trimEnd() ? `${prev.trimEnd()}\n${newEntry}` : newEntry)
    setNewSessionAdded(true)
  }

  const handleSave = async () => {
    if (!editedPatient) return
    setIsSaving(true)
    try {
      const updatedPatient: Patient = {
        ...editedPatient,
        sesiones: sesionesText ? [sesionesText] : [],
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

      onSave(updatedPatient)
      setNewSessionAdded(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al guardar los cambios')
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

          {/* Médico */}
          <div className="space-y-4 border-t border-slate-100 pt-5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Médico</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="dx">Diagnóstico</Label>
                <Input id="dx" value={editedPatient.diagnostico} onChange={(e) => setEditedPatient({ ...editedPatient, diagnostico: e.target.value })} className="border-slate-200 focus:border-[#001633]" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="doctor">Doctor</Label>
                <Input id="doctor" value={editedPatient.doctor} onChange={(e) => setEditedPatient({ ...editedPatient, doctor: e.target.value })} className="border-slate-200 focus:border-[#001633]" />
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
            <div className="space-y-2">
              <Label htmlFor="tratamiento">Tratamiento</Label>
              <Textarea id="tratamiento" value={editedPatient.tratamiento || ""} onChange={(e) => setEditedPatient({ ...editedPatient, tratamiento: e.target.value })} className="min-h-[80px] border-slate-200 focus:border-[#001633]" />
            </div>
          </div>

          {/* Sesiones */}
          <div className="space-y-4 border-t border-slate-100 pt-5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Sesiones</h3>
            <div className="flex items-center gap-3 flex-wrap">
              <Label htmlFor="sesiones-auth" className="whitespace-nowrap">Autorizadas</Label>
              <Input
                id="sesiones-auth"
                type="number"
                min={0}
                value={editedPatient.sesionesAutorizadas ?? ""}
                onChange={(e) => setEditedPatient({ ...editedPatient, sesionesAutorizadas: e.target.value ? parseInt(e.target.value, 10) : undefined })}
                placeholder="—"
                className="w-24 border-slate-200 focus:border-[#001633]"
              />
              {editedPatient.sesionesAutorizadas != null && (
                <>
                  <Label htmlFor="nro-autorizacion" className="whitespace-nowrap">N° autorización</Label>
                  <Input
                    id="nro-autorizacion"
                    value={editedPatient.nroAutorizacion ?? ""}
                    onChange={(e) => setEditedPatient({ ...editedPatient, nroAutorizacion: e.target.value || undefined })}
                    placeholder="Código / número"
                    className="flex-1 min-w-[140px] border-slate-200 focus:border-[#001633]"
                  />
                </>
              )}
            </div>
            <div className="flex justify-between items-center">
              <Label htmlFor="sesiones">
                Historial{countSessions(sesionesText) > 0 && (
                  <span className={`ml-2 text-xs font-normal ${sessionCountColor(countSessions(sesionesText), editedPatient.sesionesAutorizadas)}`}>
                    {editedPatient.sesionesAutorizadas
                      ? `${countSessions(sesionesText)} / ${editedPatient.sesionesAutorizadas} turnos`
                      : `${countSessions(sesionesText)} turnos`}
                  </span>
                )}
              </Label>
              <Button type="button" variant="outline" size="sm" className="flex items-center gap-1 text-xs border-[#001633] text-[#001633] hover:bg-[#001633] hover:text-white transition-colors" onClick={addSession}>
                <Plus className="h-3 w-3" />
                Nueva sesión
              </Button>
            </div>
            <Textarea id="sesiones" value={sesionesText} onChange={(e) => setSesionesText(e.target.value)} className="min-h-[100px] border-slate-200 focus:border-[#001633]" placeholder="Ej: 1-28/3/23 2-30/3/23 3-3/4/23" />
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
                {turnos.length > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-xs text-red-500 hover:text-red-700 h-7"
                    onClick={() => setConfirmDeleteAllOpen(true)}
                  >
                    Eliminar todos
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
                      <span className="text-gray-500 text-xs capitalize shrink-0">
                        {fechaLabel}
                      </span>
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
            {isSaving ? 'Guardando...' : 'Guardar Cambios'}
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
          <AlertDialogTitle>¿Eliminar todos los turnos?</AlertDialogTitle>
          <AlertDialogDescription>
            Se eliminarán los {turnos.length} turno{turnos.length !== 1 ? "s" : ""} agendados
            para {editedPatient?.nombre} {editedPatient?.apellido}. Esta acción no se puede deshacer.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDeleteAllTurnos}
            className="bg-red-600 hover:bg-red-700"
          >
            Eliminar todos
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  )
}
