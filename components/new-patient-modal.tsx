"use client"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
import { Plus } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
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
  return format(new Date(), "dd/MM/yyyy HH:mm", { timeZone: "America/Argentina/Buenos_Aires" })
}

function getNextSessionNumber(text: string): number {
  const matches = [...text.matchAll(/(\d+)-/g)]
  if (matches.length === 0) return 1
  return Math.max(...matches.map(m => parseInt(m[1], 10))) + 1
}

export function NewPatientModal({ open, onOpenChange }: NewPatientModalProps) {
  const [sesionesText, setSesionesText] = useState("")
  const [isSaving, setIsSaving] = useState(false)
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
    const newEntry = `${getNextSessionNumber(sesionesText)}- ${getCurrentArgentinaDateTime()}`
    setSesionesText(prev => prev.trimEnd() ? `${prev.trimEnd()}\n${newEntry}` : newEntry)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSaving(true)
    try {
      const patientsRef = ref(db, "pacientes")
      const currentUser = auth.currentUser

      await push(patientsRef, {
        ...patient,
        sesiones: sesionesText ? [sesionesText] : [],
        ultima_actualizacion: {
          fecha: new Date().toISOString(),
          usuario: currentUser ? currentUser.displayName || currentUser.email : "Unknown",
        },
      })

      if (sesionesText) {
        await addToLibroDiario({
          nombreApellido: `${patient.nombre} ${patient.apellido}`,
          obraSocial: patient.obraSocial,
        })
      }

      toast.success("Paciente registrado correctamente")
      onOpenChange(false)
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
      setSesionesText("")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error al registrar el paciente")
    } finally {
      setIsSaving(false)
    }
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
              <Label htmlFor="sesiones">Sesiones</Label>
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
              placeholder="Ej: 1- 28/03/2025 10:00"
            />
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

          <Button type="submit" className="w-auto bg-[#001633] hover:bg-[#002966] transition-colors" disabled={isSaving}>
            {isSaving ? "Registrando..." : "Registrar"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

