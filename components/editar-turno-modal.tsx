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
import { DatePicker } from "@/components/ui/date-picker"
import { CheckCircle2, Trash2, CalendarDays } from "lucide-react"
import { ref, update, remove, get } from "firebase/database"
import { db } from "@/lib/firebase"
import { Turno, TurnoEstado } from "@/types"
import { toast } from "sonner"
import { confirmarAsistencia, desconfirmarAsistencia, writeLog, LogCambio, horaToMin, minToHora } from "@/lib/helpers"

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
  const [justificado, setJustificado] = useState<boolean | undefined>(turno.justificado)
  const [isSaving, setIsSaving] = useState(false)
  const [isConfirming, setIsConfirming] = useState(false)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [reprogramando, setReprogramando] = useState(false)
  const [nuevaFecha, setNuevaFecha] = useState<Date | undefined>(undefined)
  const [isMoving, setIsMoving] = useState(false)
  const [reprogConflictOpen, setReprogConflictOpen] = useState(false)
  const [turnosEseDia, setTurnosEseDia] = useState<Turno[]>([])
  const [loadingTurnosDia, setLoadingTurnosDia] = useState(false)

  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)

  // Al elegir la fecha destino, traer los turnos de ese día (para ver la carga
  // alrededor de la hora). Excluye el turno actual y los cancelados.
  useEffect(() => {
    if (!nuevaFecha) {
      setTurnosEseDia([])
      return
    }
    let cancelado = false
    setLoadingTurnosDia(true)
    const key = format(nuevaFecha, "yyyy-MM-dd")
    get(ref(db, `turnos/${key}`))
      .then((snap) => {
        if (cancelado) return
        if (!snap.exists()) {
          setTurnosEseDia([])
          return
        }
        const list = Object.entries(snap.val() as Record<string, Omit<Turno, "id">>)
          .map(([id, t]) => ({ id, ...t }))
          .filter((t) => t.id !== turno.id && t.estado !== "cancelado")
        setTurnosEseDia(list)
      })
      .catch(() => { if (!cancelado) setTurnosEseDia([]) })
      .finally(() => { if (!cancelado) setLoadingTurnosDia(false) })
    return () => { cancelado = true }
  }, [nuevaFecha, turno.id])

  useEffect(() => {
    if (open) {
      setHora(turno.hora)
      setEstado(turno.estado)
      setNotas(turno.notas ?? "")
      setJustificado(turno.justificado)
      setReprogramando(false)
      setNuevaFecha(undefined)
      setReprogConflictOpen(false)
    }
  }, [open, turno])

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const data: Record<string, unknown> = { hora, estado }
      data.notas = notas.trim() || null
      if (estado === "ausente") data.justificado = justificado ?? false
      else data.justificado = null  // clear when not ausente
      await update(ref(db, `turnos/${fecha}/${turno.id}`), data)
      toast.success("Turno actualizado")
      const cambios: LogCambio = {}
      if (turno.hora !== hora) cambios["Hora"] = { antes: turno.hora, despues: hora }
      if (turno.estado !== estado) cambios["Estado"] = { antes: turno.estado, despues: estado }
      if ((turno.notas ?? "") !== notas.trim()) cambios["Notas"] = { antes: turno.notas ?? "", despues: notas.trim() }
      await writeLog({ accion: "editar_turno", detalle: `Editó turno de ${turno.nombre} ${turno.apellido} (${fecha} ${hora})`, entidadId: turno.id, cambios })
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
      await writeLog({ accion: "eliminar_turno", detalle: `Eliminó turno de ${turno.nombre} ${turno.apellido} (${fecha} ${hora})`, entidadId: turno.id })
      onSaved()
      onOpenChange(false)
    } catch (err) {
      console.error("[EditarTurnoModal] delete error:", err)
      toast.error(err instanceof Error ? err.message : "Error al eliminar el turno")
    }
  }

  // Move atómico: crea el turno en la fecha nueva (como pendiente) y borra el viejo.
  // Usa la hora/notas actuales del formulario; mantenemos el mismo id.
  const doReprogramar = async () => {
    if (!nuevaFecha) return
    const nuevaKey = format(nuevaFecha, "yyyy-MM-dd")
    const movido: Record<string, unknown> = {
      nombre: turno.nombre,
      apellido: turno.apellido,
      hora,
      estado: "pendiente",
    }
    if (turno.patientId) movido.patientId = turno.patientId
    if (notas.trim()) movido.notas = notas.trim()

    await update(ref(db), {
      [`turnos/${nuevaKey}/${turno.id}`]: movido,
      [`turnos/${fecha}/${turno.id}`]: null,
    })

    const desde = format(parseISO(fecha), "dd/MM/yyyy")
    const hasta = format(nuevaFecha, "dd/MM/yyyy")
    toast.success(`Turno reprogramado al ${format(nuevaFecha, "EEEE d 'de' MMMM", { locale: es })}`)
    await writeLog({
      accion: "reprogramar_turno",
      detalle: `Reprogramó el turno de ${turno.nombre} ${turno.apellido} (${hora}) del ${desde} al ${hasta}`,
      entidadId: turno.id,
      cambios: { Fecha: { antes: desde, despues: hasta } },
    })
    onSaved()
    onOpenChange(false)
  }

  const handleReprogramar = async () => {
    if (!nuevaFecha) return
    const nuevaKey = format(nuevaFecha, "yyyy-MM-dd")
    if (nuevaKey === fecha) {
      toast.error("Elegí una fecha distinta a la actual")
      return
    }
    // Aviso de duplicado reutilizando los turnos del día ya cargados por el panel de
    // la franja (turnosEseDia ya excluye el turno actual y los cancelados) — sin re-fetch.
    // El botón Mover está deshabilitado mientras cargan, así que acá ya están frescos.
    if (turno.patientId && turnosEseDia.some((t) => t.patientId === turno.patientId)) {
      setReprogConflictOpen(true)
      return
    }
    setIsMoving(true)
    try {
      await doReprogramar()
    } catch (err) {
      console.error("[EditarTurnoModal] reschedule error:", err)
      toast.error(err instanceof Error ? err.message : "No se pudo reprogramar el turno")
    } finally {
      setIsMoving(false)
    }
  }

  const handleConfirmReprogramar = async () => {
    setReprogConflictOpen(false)
    setIsMoving(true)
    try {
      await doReprogramar()
    } catch (err) {
      console.error("[EditarTurnoModal] reschedule error:", err)
      toast.error(err instanceof Error ? err.message : "No se pudo reprogramar el turno")
    } finally {
      setIsMoving(false)
    }
  }

  const handleConfirmarAsistencia = async () => {
    if (!turno.patientId) return
    setIsConfirming(true)
    try {
      // Usa turno.hora (la guardada), no el campo editable: una hora modificada
      // sin guardar no debe registrarse en el historial
      const res = await confirmarAsistencia({
        patientId: turno.patientId,
        turnoId: turno.id,
        fecha,
        hora: turno.hora,
        nombre: turno.nombre,
        apellido: turno.apellido,
      })

      if (res.alreadyConfirmed) {
        toast.info("Este turno ya estaba confirmado")
        onSaved()
        onOpenChange(false)
        return
      }

      const revert = res.revert!
      toast.success(`Sesión ${res.nextNum} registrada para ${turno.nombre} ${turno.apellido}`, {
        duration: 8000,
        action: {
          label: "Deshacer",
          onClick: async () => {
            try {
              await desconfirmarAsistencia(revert, {
                patientId: turno.patientId!,
                nombre: turno.nombre,
                apellido: turno.apellido,
                fecha,
                hora: turno.hora,
              })
              toast.success("Asistencia deshecha")
              onSaved()
            } catch {
              toast.error("No se pudo deshacer la asistencia")
            }
          },
        },
      })

      if (res.remaining != null) {
        if (res.remaining <= 0) {
          toast.warning(
            `Autorización agotada para ${turno.nombre} ${turno.apellido} — recordá gestionar una nueva`,
            { duration: 8000 }
          )
        } else if (res.remaining <= 2) {
          toast.warning(
            `Queda${res.remaining === 1 ? "" : "n"} ${res.remaining} sesión${res.remaining === 1 ? "" : "es"} disponible${res.remaining === 1 ? "" : "s"} para ${turno.nombre} ${turno.apellido}`,
            { duration: 6000 }
          )
        }
      }

      onSaved()
      onOpenChange(false)
    } catch (err) {
      console.error("[EditarTurnoModal] confirm error:", err)
      const msg =
        err instanceof Error && err.message === "PACIENTE_NO_ENCONTRADO"
          ? "No se encontró el paciente en la base de datos"
          : err instanceof Error && err.message === "TURNO_NO_ENCONTRADO"
          ? "El turno ya no existe"
          : err instanceof Error && err.message === "TURNO_FUTURO"
          ? "No se puede confirmar asistencia de un turno futuro"
          : "Error al confirmar asistencia"
      toast.error(msg)
    } finally {
      setIsConfirming(false)
    }
  }

  const fechaLabel = format(parseISO(fecha), "EEEE d 'de' MMMM", { locale: es })
  const yaAsistio = turno.estado === "asistio"
  // Turno futuro: todavía no pasó → no se puede marcar asistió/ausente ni confirmar
  const esFuturo = fecha > format(hoy, "yyyy-MM-dd")
  const estadoOptions = esFuturo
    ? ESTADO_OPTIONS.filter((o) => o.value === "pendiente" || o.value === "cancelado")
    : ESTADO_OPTIONS

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="capitalize">{fechaLabel}</DialogTitle>
            <p className="text-sm text-gray-500">
              {turno.hora} — {turno.nombre} {turno.apellido}
            </p>
          </DialogHeader>

          <div className="space-y-4">

            {/* Confirmar asistencia — solo si hay paciente vinculado y el turno no es futuro */}
            {turno.patientId && !esFuturo && (
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
                  {estadoOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      <span className={opt.color}>{opt.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {yaAsistio ? (
                <p className="text-xs text-gray-400">La asistencia ya fue confirmada y registrada en el historial del paciente.</p>
              ) : esFuturo ? (
                <p className="text-xs text-gray-400">Es un turno futuro: solo se puede dejar pendiente o cancelar. Asistió / ausente se marcan el día del turno.</p>
              ) : null}
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

            {/* Reprogramar a otra fecha (no disponible si ya asistió) */}
            {!yaAsistio && (
              <div className="border-t border-gray-100 pt-3">
                {!reprogramando ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setReprogramando(true)}
                    className="w-full border-[#001633]/30 text-[#001633] hover:bg-[#001633]/5 flex items-center gap-2"
                  >
                    <CalendarDays className="h-4 w-4" />
                    Reprogramar a otra fecha
                  </Button>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Reprogramar</Label>
                      <button
                        type="button"
                        onClick={() => { setReprogramando(false); setNuevaFecha(undefined) }}
                        className="text-xs text-gray-400 hover:text-gray-600"
                      >
                        Cancelar
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <DatePicker
                        date={nuevaFecha}
                        setDate={setNuevaFecha}
                        disabled={{ before: hoy }}
                        defaultMonth={nuevaFecha ?? parseISO(fecha)}
                        placeholder="Elegí la nueva fecha"
                        className="flex-1 min-w-0 sm:w-[200px] sm:flex-none border-[#001633]"
                      />
                      <Button
                        type="button"
                        onClick={handleReprogramar}
                        disabled={isMoving || !nuevaFecha || loadingTurnosDia}
                        className="bg-[#001633] hover:bg-[#002966]"
                      >
                        {isMoving ? "Moviendo..." : "Mover"}
                      </Button>
                    </div>
                    <p className="text-xs text-gray-500">
                      Se mueve a esa fecha (queda pendiente) con la hora de arriba.
                    </p>

                    {nuevaFecha && (() => {
                      const baseMin = horaToMin(hora)
                      const enVentana = turnosEseDia
                        .filter((t) => Math.abs(horaToMin(t.hora) - baseMin) <= 120)
                        .sort((a, b) => a.hora.localeCompare(b.hora))
                      return (
                        <div className="rounded-md border border-gray-200 bg-gray-50 p-2.5 space-y-1.5">
                          <p className="text-xs font-medium text-gray-700">
                            {loadingTurnosDia ? (
                              "Buscando turnos…"
                            ) : (
                              <>
                                Turnos ese día entre {minToHora(baseMin - 120)} y {minToHora(baseMin + 120)}{" "}
                                <span className="text-gray-400">({enVentana.length})</span>
                              </>
                            )}
                          </p>
                          {!loadingTurnosDia && (enVentana.length === 0 ? (
                            <p className="text-xs text-gray-400">No hay turnos en esa franja.</p>
                          ) : (
                            <ul className="space-y-0.5 max-h-28 overflow-y-auto">
                              {enVentana.map((t) => {
                                const mismaHora = t.hora === hora
                                return (
                                  <li
                                    key={t.id}
                                    className={`flex items-center gap-2 text-xs px-1.5 py-0.5 rounded ${
                                      mismaHora ? "bg-amber-100 text-amber-800" : "text-gray-600"
                                    }`}
                                  >
                                    <span className="font-mono tabular-nums font-medium shrink-0">{t.hora}</span>
                                    <span className="truncate">{t.nombre} {t.apellido}</span>
                                    {mismaHora && <span className="ml-auto text-[10px] shrink-0">misma hora</span>}
                                  </li>
                                )
                              })}
                            </ul>
                          ))}
                        </div>
                      )
                    })()}
                  </div>
                )}
              </div>
            )}

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

      <AlertDialog open={reprogConflictOpen} onOpenChange={setReprogConflictOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Turno duplicado</AlertDialogTitle>
            <AlertDialogDescription>
              {turno.nombre} {turno.apellido} ya tiene un turno
              {nuevaFecha && (
                <> el <span className="font-medium capitalize">{format(nuevaFecha, "EEEE d 'de' MMMM", { locale: es })}</span></>
              )}
              . ¿Reprogramar de todos modos?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmReprogramar} className="bg-[#001633] hover:bg-[#002966]">
              Reprogramar igual
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
