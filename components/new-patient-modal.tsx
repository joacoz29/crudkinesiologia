"use client"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
import { Plus, X } from "lucide-react"
import { useState } from "react"
import { format } from "date-fns-tz"
import { db } from "@/lib/firebase"
import { ref, push } from "firebase/database"
import { auth } from "@/lib/firebase"
import { addToLibroDiario } from "@/lib/helpers"

interface NewPatientModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function getCurrentArgentinaDateTime() {
  const now = new Date()
  const argentinaTime = format(now, "dd/MM/yyyy HH:mm", { timeZone: "America/Argentina/Buenos_Aires" })
  return argentinaTime
}

export function NewPatientModal({ open, onOpenChange }: NewPatientModalProps) {
  const [sesiones, setSesiones] = useState<string[]>([])
  const [patient, setPatient] = useState({
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
    tratamiento: "",
  })

  const addSession = () => {
    const currentDateTime = getCurrentArgentinaDateTime()
    if (sesiones.length === 0) {
      setSesiones([`1- ${currentDateTime}`])
    } else {
      const lastSession = sesiones[sesiones.length - 1]
      const lastNumber = Number.parseInt(lastSession.split("-")[0])
      const nextNumber = lastNumber >= 10 ? 1 : lastNumber + 1
      setSesiones([...sesiones, `${nextNumber}- ${currentDateTime}`])
    }
  }

  const removeSession = (index: number) => {
    setSesiones(sesiones.filter((_, i) => i !== index))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const patientsRef = ref(db, "pacientes")
    const currentUser = auth.currentUser
    
    await push(patientsRef, {
      ...patient,
      sesiones,
      ultima_actualizacion: {
        fecha: new Date().toISOString(),
        usuario: currentUser ? currentUser.displayName || currentUser.email : "Unknown",
      },
    })

    // Agregar al libro diario si hay sesiones
    if (sesiones.length > 0) {
      await addToLibroDiario({
        nombreApellido: `${patient.nombre} ${patient.apellido}`,
        obraSocial: patient.obraSocial,
      })
    }

    onOpenChange(false)
    // Reset form
    setPatient({
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
      tratamiento: "",
    })
    setSesiones([])
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-full sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Registrar nuevo Paciente</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="nombre">Nombre</Label>
              <Input
                id="nombre"
                value={patient.nombre}
                onChange={(e) => setPatient({ ...patient, nombre: e.target.value })}
                required
                className="border-[#001633] focus:ring-[#001633] focus:border-[#001633]"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="apellido">Apellido</Label>
              <Input
                id="apellido"
                value={patient.apellido}
                onChange={(e) => setPatient({ ...patient, apellido: e.target.value })}
                required
                className="border-[#001633] focus:ring-[#001633] focus:border-[#001633]"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Sexo</Label>
            <RadioGroup
              value={patient.sexo}
              onValueChange={(value) => setPatient({ ...patient, sexo: value })}
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
              value={patient.dni}
              onChange={(e) => setPatient({ ...patient, dni: e.target.value })}
              required
              className="border-[#001633] focus:ring-[#001633] focus:border-[#001633]"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edad">Edad</Label>
            <Input
              id="edad"
              value={patient.edad}
              onChange={(e) => setPatient({ ...patient, edad: e.target.value })}
              required
              className="border-[#001633] focus:ring-[#001633] focus:border-[#001633]"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="domicilio">Domicilio</Label>
            <Input
              id="domicilio"
              value={patient.domicilio}
              onChange={(e) => setPatient({ ...patient, domicilio: e.target.value })}
              className="border-[#001633] focus:ring-[#001633] focus:border-[#001633]"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="obra-social">Obra Social</Label>
            <Input
              id="obraSocial"
              value={patient.obraSocial}
              onChange={(e) => setPatient({ ...patient, obraSocial: e.target.value })}
              required
              className="border-[#001633] focus:ring-[#001633] focus:border-[#001633]"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="afl">N°AFL</Label>
            <Input
              id="nroAFL"
              value={patient.nroAFL}
              onChange={(e) => setPatient({ ...patient, nroAFL: e.target.value })}
              className="border-[#001633] focus:ring-[#001633] focus:border-[#001633]"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="telefono">Teléfono</Label>
            <Input
              id="telefono"
              value={patient.telefono}
              onChange={(e) => setPatient({ ...patient, telefono: e.target.value })}
              required
              className="border-[#001633] focus:ring-[#001633] focus:border-[#001633]"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="dx">DX</Label>
            <Input
              id="diagnostico"
              value={patient.diagnostico}
              onChange={(e) => setPatient({ ...patient, diagnostico: e.target.value })}
              required
              className="border-[#001633] focus:ring-[#001633] focus:border-[#001633]"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="doctor">Doctor</Label>
            <Input
              id="doctor"
              value={patient.doctor}
              onChange={(e) => setPatient({ ...patient, doctor: e.target.value })}
              required
              className="border-[#001633] focus:ring-[#001633] focus:border-[#001633]"
            />
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label>Sesiones Kinesiologia</Label>
              <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={addSession}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <div className="border rounded-md p-4 space-y-2">
              {sesiones.map((sesion, index) => (
                <div key={index} className="flex items-center space-x-2">
                  <Input
                    value={sesion}
                    onChange={(e) => {
                      const newSesiones = [...sesiones]
                      newSesiones[index] = e.target.value
                      setSesiones(newSesiones)
                    }}
                    className="flex-grow border-[#001633] focus:ring-[#001633] focus:border-[#001633]"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={() => removeSession(index)}
                    aria-label={`Remove session ${index + 1}`}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="anotaciones">Anotaciones</Label>
            <Textarea
              id="anotaciones"
              value={patient.anotaciones}
              onChange={(e) => setPatient({ ...patient, anotaciones: e.target.value })}
              className="min-h-[100px] border-[#001633] focus:ring-[#001633] focus:border-[#001633]"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tratamiento">Tratamiento</Label>
            <Textarea
              id="tratamiento"
              value={patient.tratamiento}
              onChange={(e) => setPatient({ ...patient, tratamiento: e.target.value })}
              className="min-h-[100px] border-[#001633] focus:ring-[#001633] focus:border-[#001633]"
            />
          </div>

          <Button type="submit" className="w-auto bg-[#001633] hover:bg-[#002966] transition-colors">
            Registrar
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

