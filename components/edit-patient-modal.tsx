"use client"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
import { Plus, X } from "lucide-react"
import { useState, useEffect } from "react"
import { format } from "date-fns-tz"
import { auth } from "@/lib/firebase"
import { ref, update } from "firebase/database"
import { db } from "@/lib/firebase"
import { addToLibroDiario } from "@/lib/helpers"

interface EditPatientModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  patient: Patient | null
  onSave: (updatedPatient: Patient) => void
  onAddToDiario: (nombreApellido: string) => void
}

function getNextSessionNumber(sessions: string[]): number {
  if (sessions.length === 0) return 1

  const lastSession = sessions[sessions.length - 1]
  const match = lastSession.match(/^(\d+)-/)

  if (match) {
    const lastNumber = Number.parseInt(match[1], 10)
    return lastNumber >= 10 ? 1 : lastNumber + 1
  }

  return 1
}

function getCurrentArgentinaDateTime() {
  const now = new Date()
  const argentinaTime = format(now, "dd/MM/yyyy HH:mm", { timeZone: "America/Argentina/Buenos_Aires" })
  return argentinaTime
}

export function EditPatientModal({ open, onOpenChange, patient, onSave, onAddToDiario }: EditPatientModalProps) {
  const [editedPatient, setEditedPatient] = useState<Patient | null>(null)
  const [sesiones, setSesiones] = useState<string>("")
  const [sesionesAux, setSesionesAux] = useState<string[]>([])
  const [newSessionAdded, setNewSessionAdded] = useState(false)

  useEffect(() => {
    if (patient) {
      console.log("Patient data received:", patient)
      setEditedPatient(patient)
      console.log("Patient sesiones:", patient.sesiones)
      setSesiones(patient.sesiones || "")
      // Inicializa sesionesAux con los datos de sesiones si es un array, o lo convierte a array si es string
      setSesionesAux(
        Array.isArray(patient.sesiones)
          ? patient.sesiones
          : typeof patient.sesiones === "string"
            ? patient.sesiones.split(", ")
            : [],
      )
    }
  }, [patient])

  const addSession = () => {
    const currentDateTime = getCurrentArgentinaDateTime()
    const nextNumber = getNextSessionNumber(sesionesAux)
    const newSession = `${nextNumber}- ${currentDateTime}`
    setSesionesAux([...sesionesAux, newSession])
    setNewSessionAdded(true)
  }

  const removeSession = (index: number) => {
    setSesionesAux(sesionesAux.filter((_, i) => i !== index))
  }

  const handleSave = async () => {
    if (editedPatient) {
      const currentUser = auth.currentUser
      const updatedPatient = {
        ...editedPatient,
        sesiones: sesionesAux.join(", "),
        sesionesAux,
        ultima_actualizacion: {
          fecha: new Date().toISOString(),
          usuario: currentUser ? currentUser.displayName || currentUser.email : "Unknown",
        },
      }

      const patientRef = ref(db, `pacientes/${updatedPatient.id}`)
      await update(patientRef, updatedPatient)

      // Si se agregó una nueva sesión, actualizar el libro diario
      if (newSessionAdded) {
        await addToLibroDiario({
          nombreApellido: `${updatedPatient.nombre} ${updatedPatient.apellido}`,
          obraSocial: updatedPatient.obraSocial,
        })
      }

      console.log("Patient updated successfully")
      onSave(updatedPatient)
      onOpenChange(false)
      setNewSessionAdded(false)

      // Trigger Libro Diario update
      setLibroDiarioUpdateTrigger((prev) => prev + 1)
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
              value={editedPatient.sexo}
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
              value={editedPatient.tto || ""}
              onChange={(e) => setEditedPatient({ ...editedPatient, tto: e.target.value })}
              className="min-h-[100px] border-[#001633] focus:ring-[#001633] focus:border-[#001633]"
            />
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label>Sesiones (Editable)</Label>
              <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={addSession}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <div className="border rounded-md p-4 space-y-2">
              {sesionesAux.map((sesion, index) => (
                <div key={index} className="flex items-center space-x-2">
                  <Input
                    value={sesion}
                    onChange={(e) => {
                      const newSesionesAux = [...sesionesAux]
                      newSesionesAux[index] = e.target.value
                      setSesionesAux(newSesionesAux)
                    }}
                    className="flex-grow border-[#001633] focus:ring-[#001633] focus:border-[#001633]"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={() => {
                      const newSesionesAux = sesionesAux.filter((_, i) => i !== index)
                      setSesionesAux(newSesionesAux)
                    }}
                    aria-label={`Remove session ${index + 1}`}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Sesiones (Formato Original)</Label>
            <Textarea
              value={sesiones}
              readOnly
              className="min-h-[100px] border-[#001633] focus:ring-[#001633] focus:border-[#001633]"
            />
          </div>

          <Button type="submit" className="w-auto bg-[#001633] hover:bg-[#002966] transition-colors">
            Guardar Cambios
          </Button>
          <div className="text-sm text-gray-500 mt-4">
            Última actualización: {editedPatient.ultima_actualizacion?.usuario || "N/A"} -{" "}
            {editedPatient.ultima_actualizacion?.fecha
              ? new Date(editedPatient.ultima_actualizacion.fecha).toLocaleString()
              : "N/A"}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

