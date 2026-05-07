"use client"

import { useState, useEffect } from "react"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ref, get } from "firebase/database"
import { db } from "@/lib/firebase"
import { saveTurno } from "@/lib/helpers"
import { Patient } from "@/types"
import { toast } from "sonner"

interface NuevoTurnoModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  fecha: Date
  onSaved: () => void
}

export function NuevoTurnoModal({ open, onOpenChange, fecha, onSaved }: NuevoTurnoModalProps) {
  const [patients, setPatients] = useState<Patient[]>([])
  const [search, setSearch] = useState("")
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null)
  const [hora, setHora] = useState("09:00")
  const [notas, setNotas] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)

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
      setHora("09:00")
      setNotas("")
      setShowDropdown(false)
    }
  }, [open])

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
    setIsSaving(true)
    try {
      const dateKey = format(fecha, "yyyy-MM-dd")
      await saveTurno(dateKey, {
        patientId: selectedPatient.id,
        nombre: selectedPatient.nombre,
        apellido: selectedPatient.apellido,
        hora,
        notas: notas.trim() || undefined,
        estado: "pendiente",
      })
      toast.success("Turno guardado")
      onSaved()
      onOpenChange(false)
    } catch {
      toast.error("Error al guardar el turno")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
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
                  onClick={() => {
                    setSelectedPatient(null)
                    setSearch("")
                  }}
                >
                  Cambiar
                </Button>
              </div>
            ) : (
              <div className="relative">
                <Input
                  placeholder="Buscar por nombre o apellido..."
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value)
                    setShowDropdown(true)
                  }}
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
                          onMouseDown={() => {
                            setSelectedPatient(p)
                            setSearch("")
                            setShowDropdown(false)
                          }}
                        >
                          <span>
                            {p.nombre} {p.apellido}
                          </span>
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
              Notas{" "}
              <span className="text-gray-400 font-normal text-xs">(opcional)</span>
            </Label>
            <Textarea
              id="notas"
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="Observaciones del turno..."
              className="min-h-[80px] border-[#001633]"
            />
          </div>

          <Button
            onClick={handleSave}
            disabled={isSaving || !selectedPatient}
            className="w-full bg-[#001633] hover:bg-[#002966]"
          >
            {isSaving ? "Guardando..." : "Guardar turno"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
