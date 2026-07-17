"use client"

import { Button } from "@/components/ui/button"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
import { useState } from "react"
import { toast } from "sonner"
import { db, auth } from "@/lib/firebase"
import { ref, push } from "firebase/database"
import { writeLog } from "@/lib/audit/log"
import { appendSesionAlHistorial } from "@/lib/domain/paciente"
import { edadDesdeFecha } from "@/lib/edad"
import { usePatients } from "@/lib/patients-store"
import { TratamientosAccordion } from "@/components/tratamientos-accordion"
import { Tratamiento } from "@/types"

interface NewPatientModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const EMPTY_PATIENT = {
  nombre: "",
  apellido: "",
  sexo: "masculino",
  dni: "",
  edad: "",
  fechaNacimiento: "",
  domicilio: "",
  obraSocial: "",
  nroAFL: "",
  telefono: "",
  anotaciones: "",
}

export function NewPatientModal({ open, onOpenChange }: NewPatientModalProps) {
  const [patient, setPatient] = useState(EMPTY_PATIENT)
  const [sesionesText, setSesionesText] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [confirmDupOpen, setConfirmDupOpen] = useState(false)
  const [dupNombre, setDupNombre] = useState("")

  const [tratamientos, setTratamientos] = useState<Tratamiento[]>([])
  const { patients: allPatients, isLoading: isLoadingPatients } = usePatients()

  const resetForm = () => {
    setPatient(EMPTY_PATIENT)
    setSesionesText("")
    setTratamientos([])
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    // Aviso si ya existe un paciente con el mismo DNI (el QR de opiniones y los
    // historiales dependen de que el DNI sea único)
    const dniNorm = patient.dni.replace(/\D/g, "")
    if (dniNorm) {
      // Chequeo contra la caché compartida de pacientes (sin red)
      const dup = allPatients.find(
        (p) => String(p.dni ?? "").replace(/\D/g, "") === dniNorm
      )
      if (dup) {
        setDupNombre(`${dup.nombre ?? ""} ${dup.apellido ?? ""}`.trim())
        setConfirmDupOpen(true)
        return
      }
    }
    await doSubmit()
  }

  const doSubmit = async () => {
    setIsSaving(true)
    try {
      const currentUser = auth.currentUser
      const latestTrat = tratamientos.length > 0 ? tratamientos[tratamientos.length - 1] : null
      // Si cargaron fecha de nacimiento, la edad guardada es el snapshot calculado
      const edadSnap = patient.fechaNacimiento ? String(edadDesdeFecha(patient.fechaNacimiento) ?? "") : patient.edad

      const newRef = await push(ref(db, "pacientes"), {
        ...patient,
        edad: edadSnap,
        sesiones: sesionesText ? [sesionesText] : [],
        ...(tratamientos.length > 0 && { tratamientos }),
        ...(latestTrat && { sesionesAutorizadas: latestTrat.sesionesAutorizadas }),
        ...(latestTrat?.nroAutorizacion && { nroAutorizacion: latestTrat.nroAutorizacion }),
        ...(latestTrat?.diagnostico && { diagnostico: latestTrat.diagnostico }),
        ...(latestTrat?.doctor && { doctor: latestTrat.doctor }),
        createdAt: Date.now(), // para ordenar la grilla por recién ingresados
        ultima_actualizacion: {
          fecha: new Date().toISOString(),
          usuario: currentUser ? currentUser.displayName || currentUser.email : "Unknown",
        },
      })

      toast.success("Paciente registrado correctamente")
      await writeLog({ accion: "crear_paciente", detalle: `Creó paciente ${patient.nombre} ${patient.apellido}`, entidadId: newRef.key ?? undefined })
      onOpenChange(false)
      resetForm()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error al registrar el paciente")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <>
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
                <Input id="dni" inputMode="numeric" autoComplete="off" value={patient.dni} onChange={(e) => setPatient({ ...patient, dni: e.target.value })} required className="border-slate-200 focus:border-[#001633]" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="fechaNacimiento">Fecha de nacimiento</Label>
                <Input id="fechaNacimiento" type="date" autoComplete="off" required min="1900-01-01" max={new Date().toISOString().slice(0, 10)} value={patient.fechaNacimiento} onChange={(e) => setPatient({ ...patient, fechaNacimiento: e.target.value })} className="border-slate-200 focus:border-[#001633]" />
                {edadDesdeFecha(patient.fechaNacimiento) !== null && (
                  <p className="text-xs text-slate-400">{edadDesdeFecha(patient.fechaNacimiento)} años</p>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="domicilio">Domicilio</Label>
              <Input id="domicilio" value={patient.domicilio} onChange={(e) => setPatient({ ...patient, domicilio: e.target.value })} className="border-slate-200 focus:border-[#001633]" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="telefono">Teléfono</Label>
              <Input id="telefono" type="tel" autoComplete="off" value={patient.telefono} onChange={(e) => setPatient({ ...patient, telefono: e.target.value })} required className="border-slate-200 focus:border-[#001633]" />
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

          {/* Notas */}
          <div className="space-y-4 border-t border-slate-100 pt-5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Notas</h3>
            <div className="space-y-2">
              <Label htmlFor="anotaciones">Anotaciones</Label>
              <Textarea id="anotaciones" value={patient.anotaciones} onChange={(e) => setPatient({ ...patient, anotaciones: e.target.value })} className="min-h-[80px] border-slate-200 focus:border-[#001633]" />
            </div>
          </div>

          <TratamientosAccordion
            tratamientos={tratamientos}
            onChange={setTratamientos}
            onSessionAdded={(fechaHora) => setSesionesText((prev) => appendSesionAlHistorial(prev, fechaHora))}
          />

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

          {/* Esperar a que cargue la caché de pacientes garantiza que el aviso de
              DNI duplicado corra contra datos completos (isLoading pasa a false
              también si la suscripción falla, así que nunca bloquea de forma permanente) */}
          <Button type="submit" className="w-auto bg-[#001633] hover:bg-[#002966]" disabled={isLoadingPatients} loading={isSaving}>
            {isSaving ? "Registrando..." : isLoadingPatients ? "Cargando base…" : "Registrar"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>

    <AlertDialog open={confirmDupOpen} onOpenChange={setConfirmDupOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>DNI ya registrado</AlertDialogTitle>
          <AlertDialogDescription>
            Ya existe un paciente con el DNI {patient.dni}: <span className="font-medium">{dupNombre || "(sin nombre)"}</span>.
            Registrar un duplicado parte el historial en dos. ¿Registrar de todos modos?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => { setConfirmDupOpen(false); doSubmit() }}
            className="bg-[#001633] hover:bg-[#002966]"
          >
            Registrar igual
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  )
}
