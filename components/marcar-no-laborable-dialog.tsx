"use client"

import { useEffect, useState } from "react"
import { format } from "date-fns"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { DatePicker } from "@/components/ui/date-picker"
import { marcarNoLaborable } from "@/lib/flujo/no-laborables"
import { fechasEntre } from "@/lib/domain/no-laborables"
import { toast } from "sonner"

const MOTIVOS_RAPIDOS = ["Vacaciones", "Capacitación", "Asueto"]
const MAX_DIAS = 60

export function MarcarNoLaborableDialog({
  open,
  onOpenChange,
  fechaInicial,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  fechaInicial: Date
  onSaved: () => void
}) {
  const [desde, setDesde] = useState(fechaInicial)
  const [hasta, setHasta] = useState(fechaInicial)
  const [motivo, setMotivo] = useState("")
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setDesde(fechaInicial)
      setHasta(fechaInicial)
      setMotivo("")
    }
  }, [open, fechaInicial])

  const desdeKey = format(desde, "yyyy-MM-dd")
  const hastaKey = format(hasta, "yyyy-MM-dd")
  const dias = fechasEntre(desdeKey, hastaKey).length
  const error =
    dias === 0 ? "La fecha final no puede ser anterior a la inicial"
    : dias > MAX_DIAS ? `Máximo ${MAX_DIAS} días por vez`
    : null

  const handleSave = async () => {
    const m = motivo.trim()
    if (!m || error) return
    setIsSaving(true)
    try {
      const res = await marcarNoLaborable(desdeKey, hastaKey, m)
      toast.success(res.dias === 1 ? "Día marcado como no laborable" : `${res.dias} días marcados como no laborables`)
      if (res.pendientes > 0) {
        toast.warning(
          `Hay ${res.pendientes} turno${res.pendientes !== 1 ? "s" : ""} pendiente${res.pendientes !== 1 ? "s" : ""} en ${res.dias === 1 ? "ese día" : "esos días"} — reprogramalos o cancelalos desde la agenda`,
          { duration: 10000 },
        )
      }
      onSaved()
      onOpenChange(false)
    } catch (err) {
      console.error("[MarcarNoLaborable]", err)
      toast.error("No se pudo marcar el día (¿tenés permisos de administrador?)")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Marcar día no laborable</DialogTitle>
          <DialogDescription>
            Ese día o rango no se van a poder agendar turnos. Los turnos que ya existan no se tocan.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label>Desde</Label>
              <DatePicker
                date={desde}
                setDate={(d) => { setDesde(d); if (d > hasta) setHasta(d) }}
                defaultMonth={desde}
                className="w-full border-[#001633] text-xs px-2"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Hasta</Label>
              <DatePicker
                date={hasta}
                setDate={setHasta}
                disabled={{ before: desde }}
                defaultMonth={hasta}
                className="w-full border-[#001633] text-xs px-2"
              />
            </div>
          </div>
          {error ? (
            <p className="text-xs text-red-600">{error}</p>
          ) : (
            <p className="text-xs text-gray-500">{dias} día{dias !== 1 ? "s" : ""} (incluye fines de semana)</p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="motivo-no-laborable">Motivo</Label>
            <Input
              id="motivo-no-laborable"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              maxLength={100}
              placeholder="Ej.: Vacaciones"
              className="border-[#001633]"
            />
            <div className="flex flex-wrap gap-1.5">
              {MOTIVOS_RAPIDOS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMotivo(m)}
                  className="text-xs px-2.5 py-1 rounded-full border border-gray-200 text-gray-600 hover:border-[#001633]"
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          <Button
            onClick={handleSave}
            disabled={!motivo.trim() || !!error}
            loading={isSaving}
            className="w-full bg-[#001633] hover:bg-[#002966]"
          >
            {isSaving ? "Guardando..." : dias > 1 ? `Marcar ${dias} días` : "Marcar día"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
