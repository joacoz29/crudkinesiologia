"use client"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Loader2, Bone, Lock } from "lucide-react"
import { useState, useEffect, useMemo } from "react"
import { format, parseISO, isValid } from "date-fns"
import { es } from "date-fns/locale"
import { ref, update } from "firebase/database"
import { auth, db } from "@/lib/firebase"
import { parseTratamientosRaw, writeLog } from "@/lib/helpers"
import { edadActual } from "@/lib/edad"
import { getUserDisplayName } from "@/lib/auth-helper"
import { Patient } from "@/types"
import { toast } from "sonner"

interface TraumaFichaModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  patient: Patient | null
}

// Ficha desde el lente del traumatólogo: los datos del paciente y la historia de
// kinesiología van en SOLO LECTURA (modelo compartido, ver [[traumatologia-feature]]);
// lo único editable es la sección de traumatología, que se guarda en
// pacientes/{id}/traumatologia sin tocar los tratamientos/sesiones de kine.
export function TraumaFichaModal({ open, onOpenChange, patient }: TraumaFichaModalProps) {
  const [diagnostico, setDiagnostico] = useState("")
  const [notas, setNotas] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!patient) return
    setDiagnostico(patient.traumatologia?.diagnostico ?? "")
    setNotas(patient.traumatologia?.notas ?? "")
  }, [patient])

  const tratamientos = useMemo(() => parseTratamientosRaw(patient?.tratamientos), [patient])
  const historialLibre = useMemo(() => (patient?.sesiones ?? []).join(" ").trim(), [patient])

  if (!patient) return null

  const prevDiag = patient.traumatologia?.diagnostico ?? ""
  const prevNotas = patient.traumatologia?.notas ?? ""
  const dirty = diagnostico.trim() !== prevDiag.trim() || notas.trim() !== prevNotas.trim()

  const ua = patient.traumatologia?.ultima_actualizacion
  const uaFecha =
    ua?.fecha && isValid(parseISO(ua.fecha))
      ? format(parseISO(ua.fecha), "d 'de' MMMM yyyy, HH:mm", { locale: es })
      : null

  const edad = edadActual(patient)

  const handleSave = async () => {
    setSaving(true)
    try {
      const ficha = {
        diagnostico: diagnostico.trim(),
        notas: notas.trim(),
        ultima_actualizacion: {
          fecha: new Date().toISOString(),
          usuario: getUserDisplayName(auth.currentUser),
        },
      }
      // Escritura dirigida al sub-nodo: no toca el resto de la ficha compartida.
      await update(ref(db, `pacientes/${patient.id}`), { traumatologia: ficha })
      await writeLog({
        accion: "editar_traumatologia",
        detalle: `Editó la ficha de traumatología de ${patient.nombre} ${patient.apellido}`,
        entidadId: patient.id,
      })
      toast.success("Ficha de traumatología guardada")
      onOpenChange(false)
    } catch (e) {
      console.error("Error guardando ficha de traumatología", e)
      toast.error("No se pudo guardar la ficha")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-full sm:max-w-2xl max-h-[90vh] overflow-y-auto"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bone className="h-5 w-5 text-indigo-600" />
            {patient.nombre} {patient.apellido}
          </DialogTitle>
          <p className="text-xs text-slate-400">Ficha de traumatología</p>
        </DialogHeader>

        <div className="space-y-6">
          {/* Datos del paciente (compartidos, solo lectura acá) */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-lg border border-slate-100 bg-slate-50 p-3">
            <Dato label="Edad" value={edad !== null ? `${edad} años` : "—"} />
            <Dato label="DNI" value={patient.dni || "—"} />
            <Dato label="Obra social" value={patient.obraSocial || "—"} />
            <Dato label="Teléfono" value={patient.telefono || "—"} />
          </div>

          {/* Historia de kinesiología — solo lectura */}
          <section>
            <div className="mb-2 flex items-center gap-1.5">
              <Lock className="h-3.5 w-3.5 text-slate-400" />
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Historia de kinesiología · solo lectura
              </h3>
            </div>

            {tratamientos.length === 0 && !historialLibre ? (
              <p className="text-sm italic text-slate-400">Sin historia de kinesiología registrada.</p>
            ) : (
              <div className="space-y-2">
                {tratamientos.map((t) => (
                  <div key={t.id} className="rounded-md border border-slate-200 bg-white p-2.5 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-slate-700">{t.diagnostico || "Sin diagnóstico"}</span>
                      <span className="shrink-0 text-xs text-slate-500">
                        {t.sesiones.length}/{t.sesionesAutorizadas} ses.
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-slate-400">
                      {t.doctor ? `Dr. ${t.doctor}` : "Sin derivante"}
                      {t.nroAutorizacion ? ` · Aut. ${t.nroAutorizacion}` : ""}
                    </div>
                  </div>
                ))}
                {historialLibre && (
                  <div className="rounded-md border border-slate-200 bg-white p-2.5">
                    <p className="mb-1 text-[11px] uppercase tracking-wide text-slate-400">Historial libre</p>
                    <p className="whitespace-pre-wrap break-words font-mono text-xs text-slate-600">{historialLibre}</p>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Traumatología — editable */}
          <section className="space-y-4 rounded-lg border border-indigo-100 bg-indigo-50/40 p-4">
            <div className="flex items-center gap-1.5">
              <Bone className="h-4 w-4 text-indigo-600" />
              <h3 className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Traumatología</h3>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="trauma-diag" className="text-xs text-slate-600">
                Diagnóstico
              </Label>
              <Input
                id="trauma-diag"
                value={diagnostico}
                onChange={(e) => setDiagnostico(e.target.value)}
                placeholder="Ej: Lumbalgia mecánica, gonartrosis…"
                className="border-indigo-200 bg-white focus:border-indigo-500"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="trauma-notas" className="text-xs text-slate-600">
                Notas / evolución
              </Label>
              <Textarea
                id="trauma-notas"
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
                placeholder="Consultas, indicaciones, órdenes, evolución…"
                className="min-h-[120px] border-indigo-200 bg-white text-sm focus:border-indigo-500"
              />
            </div>

            {uaFecha && (
              <p className="text-[11px] text-slate-400">
                Última edición: {uaFecha}
                {ua?.usuario ? ` · ${ua.usuario}` : ""}
              </p>
            )}
          </section>

          <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
              Cerrar
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              disabled={!dirty || saving}
              className="gap-1.5 bg-indigo-600 text-white hover:bg-indigo-700"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Guardar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Dato({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className="truncate text-sm text-slate-700" title={value}>
        {value}
      </p>
    </div>
  )
}
