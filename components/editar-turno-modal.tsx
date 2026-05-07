"use client"

import { useState, useEffect } from "react"
import { format, parseISO } from "date-fns"
import { es } from "date-fns/locale"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Trash2 } from "lucide-react"
import { ref, update, remove } from "firebase/database"
import { db } from "@/lib/firebase"
import { Turno, TurnoEstado } from "@/types"
import { toast } from "sonner"

const ESTADO_OPTIONS: { value: TurnoEstado; label: string; color: string }[] = [
  { value: "pendiente", label: "Pendiente", color: "text-blue-700" },
  { value: "asistio", label: "Asistió", color: "text-green-700" },
  { value: "ausente", label: "Ausente", color: "text-red-700" },
  { value: "cancelado", label: "Cancelado", color: "text-gray-500" },
]

interface EditarTurnoModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  fecha: string
  turno: Turno
  onSaved: () => void
}

export function EditarTurnoModal({
  open,
  onOpenChange,
  fecha,
  turno,
  onSaved,
}: EditarTurnoModalProps) {
  const [hora, setHora] = useState(turno.hora)
  const [estado, setEstado] = useState<TurnoEstado>(turno.estado)
  const [notas, setNotas] = useState(turno.notas ?? "")
  const [isSaving, setIsSaving] = useState(false)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)

  useEffect(() => {
    if (open) {
      setHora(turno.hora)
      setEstado(turno.estado)
      setNotas(turno.notas ?? "")
    }
  }, [open, turno])

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const data: Record<string, unknown> = { hora, estado }
      if (notas.trim()) data.notas = notas.trim()
      console.log("[EditarTurnoModal] updating turnos/" + fecha + "/" + turno.id, data)
      await update(ref(db, `turnos/${fecha}/${turno.id}`), data)
      toast.success("Turno actualizado")
      onSaved()
      onOpenChange(false)
    } catch (err) {
      console.error("[EditarTurnoModal] update error:", err)
      toast.error(err instanceof Error ? err.message : "Error al actualizar el turno")
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    try {
      console.log("[EditarTurnoModal] deleting turnos/" + fecha + "/" + turno.id)
      await remove(ref(db, `turnos/${fecha}/${turno.id}`))
      toast.success("Turno eliminado")
      onSaved()
      onOpenChange(false)
    } catch (err) {
      console.error("[EditarTurnoModal] delete error:", err)
      toast.error(err instanceof Error ? err.message : "Error al eliminar el turno")
    }
  }

  const fechaLabel = format(parseISO(fecha), "EEEE d 'de' MMMM", { locale: es })

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="capitalize">{fechaLabel}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Paciente (read-only) */}
            <div className="space-y-1">
              <Label className="text-xs text-gray-500 uppercase tracking-wide">Paciente</Label>
              <p className="text-base font-medium text-gray-900">
                {turno.nombre} {turno.apellido}
              </p>
            </div>

            {/* Hora */}
            <div className="space-y-2">
              <Label htmlFor="edit-hora">Horario</Label>
              <Input
                id="edit-hora"
                type="time"
                value={hora}
                onChange={(e) => setHora(e.target.value)}
                className="border-[#001633] w-36"
              />
            </div>

            {/* Estado */}
            <div className="space-y-2">
              <Label>Estado</Label>
              <Select value={estado} onValueChange={(v) => setEstado(v as TurnoEstado)}>
                <SelectTrigger className="border-[#001633] w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ESTADO_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      <span className={opt.color}>{opt.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Notas */}
            <div className="space-y-2">
              <Label htmlFor="edit-notas">
                Notas{" "}
                <span className="text-gray-400 font-normal text-xs">(opcional)</span>
              </Label>
              <Textarea
                id="edit-notas"
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
                placeholder="Observaciones del turno..."
                className="min-h-[80px] border-[#001633]"
              />
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-1">
              <Button
                onClick={handleSave}
                disabled={isSaving}
                className="flex-1 bg-[#001633] hover:bg-[#002966]"
              >
                {isSaving ? "Guardando..." : "Guardar cambios"}
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="border-red-300 text-red-600 hover:bg-red-50"
                onClick={() => setConfirmDeleteOpen(true)}
                title="Eliminar turno"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar turno?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará el turno de{" "}
              <span className="font-medium">
                {turno.nombre} {turno.apellido}
              </span>{" "}
              del {fechaLabel} a las {turno.hora}. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-red-600 hover:bg-red-700"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
