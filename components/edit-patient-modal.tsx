"use client"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
import { Plus } from "lucide-react"
import { useState, useEffect } from "react"
import { format } from "date-fns-tz"
import { auth } from "@/lib/firebase"
import { addToLibroDiario } from "@/lib/helpers"
import { Patient } from "@/types"
import { toast } from "sonner"

interface EditPatientModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  patient: Patient | null
  onSave: (updatedPatient: Patient) => void
  onAddToDiario: (nombreApellido: string) => void
  setLibroDiarioUpdateTrigger: (value: (prev: number) => number) => void
}

function getNextSessionNumber(text: string): number {
  const matches = [...text.matchAll(/(\d+)-/g)]
  if (matches.length === 0) return 1
  const numbers = matches.map(m => parseInt(m[1], 10))
  return Math.max(...numbers) + 1
}

function getCurrentArgentinaDateTime() {
  return format(new Date(), "dd/MM/yyyy HH:mm", { timeZone: "America/Argentina/Buenos_Aires" })
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
  onAddToDiario,
  setLibroDiarioUpdateTrigger,
}: EditPatientModalProps) {
  const [editedPatient, setEditedPatient] = useState<Patient | null>(null)
  const [sesionesText, setSesionesText] = useState("")
  const [newSessionAdded, setNewSessionAdded] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (patient) {
      setEditedPatient(patient)
      setSesionesText(
        Array.isArray(patient.sesiones) ? formatSesiones(patient.sesiones.join(" ")) : ""
      )
    }
  }, [patient])

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
      onOpenChange(false)
      setNewSessionAdded(false)
      setLibroDiarioUpdateTrigger((prev) => prev + 1)
      toast.success('Paciente actualizado correctamente')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al guardar los cambios')
    } finally {
      setIsSaving(false)
    }
  }

  if (!editedPatient) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-full sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar Paciente</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            handleSave()
          }}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="nombre">Nombre</Label>
              <Input
                id="nombre"
                value={editedPatient.nombre}
                onChange={(e) => setEditedPatient({ ...editedPatient, nombre: e.target.value })}
                className="border-[#001633] focus:ring-[#001633] focus:border-[#001633]"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="apellido">Apellido</Label>
              <Input
                id="apellido"
                value={editedPatient.apellido}
                onChange={(e) => setEditedPatient({ ...editedPatient, apellido: e.target.value })}
                className="border-[#001633] focus:ring-[#001633] focus:border-[#001633]"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Sexo</Label>
            <RadioGroup
              value={editedPatient.sexo || ""}
              onValueChange={(value) => setEditedPatient({ ...editedPatient, sexo: value })}
              className="flex gap-4"
            >
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

          <div className="space-y-2">
            <Label htmlFor="dni">DNI</Label>
            <Input
              id="dni"
              value={editedPatient.dni}
              onChange={(e) => setEditedPatient({ ...editedPatient, dni: e.target.value })}
              className="border-[#001633] focus:ring-[#001633] focus:border-[#001633]"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edad">Edad</Label>
            <Input
              id="edad"
              value={editedPatient.edad}
              onChange={(e) => setEditedPatient({ ...editedPatient, edad: e.target.value })}
              className="border-[#001633] focus:ring-[#001633] focus:border-[#001633]"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="domicilio">Domicilio</Label>
            <Input
              id="domicilio"
              value={editedPatient.domicilio || ""}
              onChange={(e) => setEditedPatient({ ...editedPatient, domicilio: e.target.value })}
              className="border-[#001633] focus:ring-[#001633] focus:border-[#001633]"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="obra-social">Obra Social</Label>
            <Input
              id="obra-social"
              value={editedPatient.obraSocial}
              onChange={(e) => setEditedPatient({ ...editedPatient, obraSocial: e.target.value })}
              className="border-[#001633] focus:ring-[#001633] focus:border-[#001633]"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="afl">N°AFL</Label>
            <Input
              id="afl"
              value={editedPatient.nroAFL}
              onChange={(e) => setEditedPatient({ ...editedPatient, nroAFL: e.target.value })}
              className="border-[#001633] focus:ring-[#001633] focus:border-[#001633]"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="telefono">Teléfono</Label>
            <Input
              id="telefono"
              value={editedPatient.telefono}
              onChange={(e) => setEditedPatient({ ...editedPatient, telefono: e.target.value })}
              className="border-[#001633] focus:ring-[#001633] focus:border-[#001633]"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="dx">DX</Label>
            <Input
              id="dx"
              value={editedPatient.diagnostico}
              onChange={(e) => setEditedPatient({ ...editedPatient, diagnostico: e.target.value })}
              className="border-[#001633] focus:ring-[#001633] focus:border-[#001633]"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="doctor">Doctor</Label>
            <Input
              id="doctor"
              value={editedPatient.doctor}
              onChange={(e) => setEditedPatient({ ...editedPatient, doctor: e.target.value })}
              className="border-[#001633] focus:ring-[#001633] focus:border-[#001633]"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="anotaciones">Anotaciones</Label>
            <Textarea
              id="anotaciones"
              value={editedPatient.anotaciones || ""}
              onChange={(e) => setEditedPatient({ ...editedPatient, anotaciones: e.target.value })}
              className="min-h-[100px] border-[#001633] focus:ring-[#001633] focus:border-[#001633]"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tratamiento">Tratamiento</Label>
            <Textarea
              id="tratamiento"
              value={editedPatient.tratamiento || ""}
              onChange={(e) => setEditedPatient({ ...editedPatient, tratamiento: e.target.value })}
              className="min-h-[100px] border-[#001633] focus:ring-[#001633] focus:border-[#001633]"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <Label htmlFor="sesiones-auth" className="whitespace-nowrap">Sesiones autorizadas</Label>
              <Input
                id="sesiones-auth"
                type="number"
                min={0}
                value={editedPatient.sesionesAutorizadas ?? ""}
                onChange={(e) => setEditedPatient({
                  ...editedPatient,
                  sesionesAutorizadas: e.target.value ? parseInt(e.target.value, 10) : undefined,
                })}
                placeholder="—"
                className="w-24 border-[#001633] focus:ring-[#001633] focus:border-[#001633]"
              />
            </div>
            <div className="flex justify-between items-center">
              <Label htmlFor="sesiones">
                Sesiones{countSessions(sesionesText) > 0 && (
                  <span className={`ml-2 text-xs font-normal ${sessionCountColor(countSessions(sesionesText), editedPatient.sesionesAutorizadas)}`}>
                    {editedPatient.sesionesAutorizadas
                      ? `${countSessions(sesionesText)} / ${editedPatient.sesionesAutorizadas} turnos`
                      : `${countSessions(sesionesText)} turnos`
                    }
                  </span>
                )}
              </Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="flex items-center gap-1 text-xs border-[#001633] text-[#001633] hover:bg-[#001633] hover:text-white transition-colors"
                onClick={addSession}
              >
                <Plus className="h-3 w-3" />
                Nueva sesión
              </Button>
            </div>
            <Textarea
              id="sesiones"
              value={sesionesText}
              onChange={(e) => setSesionesText(e.target.value)}
              className="min-h-[100px] border-[#001633] focus:ring-[#001633] focus:border-[#001633]"
              placeholder="Ej: Autorizació 1-28/3/23 2-30/3/23 3-3/4/23"
            />
          </div>

          <Button
            type="submit"
            className="w-auto bg-[#001633] hover:bg-[#002966] transition-colors"
            disabled={isSaving}
          >
            {isSaving ? 'Guardando...' : 'Guardar Cambios'}
          </Button>

          <div className="text-sm text-gray-500 mt-4">
            Última actualización: {editedPatient.ultima_actualizacion?.usuario || "N/A"} —{" "}
            {editedPatient.ultima_actualizacion?.fecha
              ? new Date(editedPatient.ultima_actualizacion.fecha).toLocaleString()
              : "N/A"}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
