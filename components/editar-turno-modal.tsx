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
import { CheckCircle2, Trash2 } from "lucide-react"
import { ref, update, remove, get } from "firebase/database"
import { db, auth } from "@/lib/firebase"
import { Turno, TurnoEstado } from "@/types"
import { toast } from "sonner"
import { addToLibroDiario } from "@/lib/helpers"

const ESTADO_OPTIONS: { value: TurnoEstado; label: string; color: string }[] = [
  { value: "pendiente", label: "Pendiente", color: "text-blue-700" },
  { value: "asistio", label: "Asistió", color: "text-green-700" },
  { value: "ausente", label: "Ausente", color: "text-red-700" },
  { value: "cancelado", label: "Cancelado", color: "text-gray-500" },
]

function getNextSessionNumber(text: string): number {
  const matches = [...text.matchAll(/(\d+)-/g)]
  if (matches.length === 0) return 1
  return Math.max(...matches.map((m) => parseInt(m[1], 10))) + 1
}

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
  const [justificado, setJustificado] = useState<boolean | undefined>(turno.justificado)
  const [isSaving, setIsSaving] = useState(false)
  const [isConfirming, setIsConfirming] = useState(false)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)

  useEffect(() => {
    if (open) {
      setHora(turno.hora)
      setEstado(turno.estado)
      setNotas(turno.notas ?? "")
      setJustificado(turno.justificado)
    }
  }, [open, turno])

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const data: Record<string, unknown> = { hora, estado }
      if (notas.trim()) data.notas = notas.trim()
      if (estado === "ausente") data.justificado = justificado ?? false
      else data.justificado = null  // clear when not ausente
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
      await remove(ref(db, `turnos/${fecha}/${turno.id}`))
      toast.success("Turno eliminado")
      onSaved()
      onOpenChange(false)
    } catch (err) {
      console.error("[EditarTurnoModal] delete error:", err)
      toast.error(err instanceof Error ? err.message : "Error al eliminar el turno")
    }
  }

  const handleConfirmarAsistencia = async () => {
    if (!turno.patientId) return
    setIsConfirming(true)
    try {
      // 1. Fetch current patient data
      const snap = await get(ref(db, `pacientes/${turno.patientId}`))
      if (!snap.exists()) {
        toast.error("No se encontró el paciente en la base de datos")
        return
      }

      const raw = snap.val() as Record<string, unknown>
      const rawSesiones = raw.sesiones
      const sesionesActual =
        Array.isArray(rawSesiones)
          ? rawSesiones.join(" ")
          : typeof rawSesiones === "string"
          ? rawSesiones
          : ""

      // 2. Build new session entry using turno's date and time
      const [year, month, day] = fecha.split("-")
      const nextNum = getNextSessionNumber(sesionesActual)
      const newEntry = `${nextNum}- ${day}/${month}/${year} ${hora}`
      const updatedSesiones = sesionesActual.trim()
        ? `${sesionesActual.trim()}\n${newEntry}`
        : newEntry

      // 3. Update patient record
      await update(ref(db, `pacientes/${turno.patientId}`), {
        sesiones: [updatedSesiones],
        ultima_actualizacion: {
          fecha: new Date().toISOString(),
          usuario:
            auth.currentUser?.displayName ||
            auth.currentUser?.email ||
            "Calendario",
        },
      })

      // 4. Mark turno as asistió
      await update(ref(db, `turnos/${fecha}/${turno.id}`), {
        estado: "asistio",
      })

      // 5. Add to libro diario for that day
      await addToLibroDiario({
        nombreApellido: `${turno.nombre} ${turno.apellido}`,
        obraSocial: (raw.obraSocial as string) || "-",
        fecha,
      })

      toast.success(`Sesión ${nextNum} registrada para ${turno.nombre} ${turno.apellido}`)
      onSaved()
      onOpenChange(false)
    } catch (err) {
      console.error("[EditarTurnoModal] confirm error:", err)
      toast.error("Error al confirmar asistencia")
    } finally {
      setIsConfirming(false)
    }
  }

  const fechaLabel = format(parseISO(fecha), "EEEE d 'de' MMMM", { locale: es })
  const yaAsistio = turno.estado === "asistio"

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="capitalize">{fechaLabel}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Paciente */}
            <div className="space-y-1">
              <Label className="text-xs text-gray-500 uppercase tracking-wide">Paciente</Label>
              <p className="text-base font-medium text-gray-900">
                {turno.nombre} {turno.apellido}
              </p>
            </div>

            {/* Confirmar asistencia — only when patientId is linked */}
            {turno.patientId && (
              <div className={[
                "rounded-lg border px-4 py-3 flex items-center justify-between gap-3",
                yaAsistio
                  ? "bg-green-50 border-green-200"
                  : "bg-gray-50 border-gray-200",
              ].join(" ")}>
                <div>
                  <p className={[
                    "text-sm font-medium",
                    yaAsistio ? "text-green-800" : "text-gray-700",
                  ].join(" ")}>
                    {yaAsistio ? "Asistencia registrada" : "¿El paciente asistió?"}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {yaAsistio
                      ? "La sesión ya fue agregada al historial del paciente"
                      : "Registra la sesión automáticamente en el historial"}
                  </p>
                </div>
                {yaAsistio ? (
                  <CheckCircle2 className="h-6 w-6 text-green-500 shrink-0" />
                ) : (
                  <Button
                    size="sm"
                    onClick={handleConfirmarAsistencia}
                    disabled={isConfirming}
                    className="shrink-0 bg-green-600 hover:bg-green-700 text-white"
                  >
                    {isConfirming ? "Registrando..." : "Confirmar"}
                  </Button>
                )}
              </div>
            )}

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
              <Select value={estado} onValueChange={(v) => setEstado(v as TurnoEstado)} disabled={yaAsistio}>
                <SelectTrigger className="border-[#001633] w-44 disabled:opacity-60 disabled:cursor-not-allowed">
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
              {yaAsistio && (
                <p className="text-xs text-gray-400">La asistencia ya fue confirmada y registrada en el historial del paciente.</p>
              )}
            </div>

            {/* Justificado — only when ausente */}
            {estado === "ausente" && (
              <div className="space-y-2">
                <Label>¿Justificó la falta?</Label>
                <div className="flex gap-2">
                  {[{ label: "Sí, justificó", value: true }, { label: "No justificó", value: false }].map((opt) => (
                    <button
                      key={String(opt.value)}
                      type="button"
                      onClick={() => setJustificado(opt.value)}
                      className={[
                        "px-3 py-1.5 text-sm rounded-full border transition-colors",
                        justificado === opt.value
                          ? opt.value
                            ? "bg-orange-500 text-white border-orange-500"
                            : "bg-red-600 text-white border-red-600"
                          : "border-gray-200 text-gray-600 hover:border-gray-400",
                      ].join(" ")}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

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
