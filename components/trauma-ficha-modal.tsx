"use client"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Loader2, Bone, Lock, Plus, Trash2, Check, X, ChevronDown } from "lucide-react"
import { useState, useEffect, useMemo } from "react"
import { format, parseISO, isValid } from "date-fns"
import { format as formatTZ } from "date-fns-tz"
import { es } from "date-fns/locale"
import { ref, update } from "firebase/database"
import { auth, db } from "@/lib/firebase"
import { parseTratamientosRaw } from "@/lib/domain/paciente"
import { parseConsultasTrauma } from "@/lib/domain/trauma"
import { cobroTraumaUpdates } from "@/lib/data/libro"
import { writeLog } from "@/lib/audit/log"
import { edadActual } from "@/lib/edad"
import { getUserDisplayName } from "@/lib/auth-helper"
import { Patient, TraumatologiaConsulta } from "@/types"
import { toast } from "sonner"

interface TraumaFichaModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  patient: Patient | null
}

// Fecha local de Argentina, no UTC ni la del dispositivo (después de las 21:00
// AR, toISOString cae en "mañana" — misma convención que el resto de helpers).
const TZ = "America/Argentina/Buenos_Aires"
const hoyISO = () => formatTZ(new Date(), "yyyy-MM-dd", { timeZone: TZ })
const nuevoId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

function fmtFechaConsulta(f: string): string {
  if (!f) return "Sin fecha"
  const d = parseISO(f)
  return isValid(d) ? format(d, "d 'de' MMM yyyy", { locale: es }) : f
}

// Ficha desde el lente del traumatólogo: los datos del paciente y la historia de
// kinesiología van en SOLO LECTURA (modelo compartido, ver [[traumatologia-feature]]).
// La sección de trauma es un HISTORIAL: cada visita agrega una consulta nueva
// (no se pisa la anterior), guardado en pacientes/{id}/traumatologia/consultas.
export function TraumaFichaModal({ open, onOpenChange, patient }: TraumaFichaModalProps) {
  // Form de "nueva consulta"
  const [fecha, setFecha] = useState(hoyISO())
  const [diagnostico, setDiagnostico] = useState("")
  const [notas, setNotas] = useState("")
  const [monto, setMonto] = useState("")
  // Historial local: se siembra del paciente y se actualiza al agregar/eliminar,
  // así la UI refleja el cambio sin depender de que el prop se refresque.
  const [consultas, setConsultas] = useState<TraumatologiaConsulta[]>([])
  const [saving, setSaving] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  // Acordeones de la historia de kine (cerrados por default: la ficha abre
  // enfocada en trauma, la historia se despliega a demanda)
  const [kineOpen, setKineOpen] = useState(false)
  const [histLibreOpen, setHistLibreOpen] = useState(false)

  useEffect(() => {
    if (!patient) return
    setConsultas(parseConsultasTrauma(patient.traumatologia))
    setFecha(hoyISO())
    setDiagnostico("")
    setNotas("")
    setMonto("")
    setConfirmDeleteId(null)
    setKineOpen(false)
    setHistLibreOpen(false)
  }, [patient])

  const tratamientos = useMemo(() => parseTratamientosRaw(patient?.tratamientos), [patient])
  const historialLibre = useMemo(() => (patient?.sesiones ?? []).join(" ").trim(), [patient])

  if (!patient) return null

  const edad = edadActual(patient)

  // Persiste el historial completo en el sub-nodo traumatologia. Reemplaza el
  // objeto entero: así, al primer guardado, se descartan los campos legacy
  // (diagnostico/notas sueltos) sin tocar el resto de la ficha compartida.
  // `extraUpdates` (p. ej. el cobro en el Libro) va en la MISMA escritura
  // multi-path: o se guarda todo o no se guarda nada.
  const persistir = async (lista: TraumatologiaConsulta[], detalle: string, extraUpdates: Record<string, unknown> = {}) => {
    await update(ref(db), {
      [`pacientes/${patient.id}/traumatologia`]: {
        consultas: lista,
        ultima_actualizacion: { fecha: new Date().toISOString(), usuario: getUserDisplayName(auth.currentUser) },
      },
      ...extraUpdates,
    })
    await writeLog({ accion: "editar_traumatologia", detalle, entidadId: patient.id })
  }

  // Al persistir, una entrada legacy (si la hubiera) se materializa con id real.
  const materializarLegacy = (c: TraumatologiaConsulta): TraumatologiaConsulta =>
    c.id === "legacy" ? { ...c, id: nuevoId(), createdAt: c.createdAt || Date.now() - 1 } : c

  const handleAgregar = async () => {
    if (!notas.trim()) return
    setSaving(true)
    try {
      const montoNum = Number(monto) || 0
      const fechaConsulta = fecha || hoyISO()
      const nueva: TraumatologiaConsulta = {
        id: nuevoId(),
        fecha: fechaConsulta,
        ...(!!diagnostico.trim() && { diagnostico: diagnostico.trim() }),
        notas: notas.trim(),
        ...(montoNum > 0 && { monto: montoNum }),
        usuario: getUserDisplayName(auth.currentUser),
        createdAt: Date.now(),
      }
      const lista = [...consultas.map(materializarLegacy), nueva]
      // Si cargó un importe, el movimiento del Libro (caja) va en la misma escritura.
      const cobro = cobroTraumaUpdates({
        nombreApellido: `${patient.nombre} ${patient.apellido}`,
        obraSocial: patient.obraSocial,
        monto: montoNum,
        fecha: fechaConsulta,
      })
      await persistir(
        lista,
        `Agregó una consulta de traumatología de ${patient.nombre} ${patient.apellido}${montoNum > 0 ? ` (cobro $${montoNum})` : ""}`,
        cobro,
      )
      setConsultas(parseConsultasTrauma({ consultas: lista }))
      setDiagnostico("")
      setNotas("")
      setMonto("")
      setFecha(hoyISO())
      toast.success(montoNum > 0 ? "Consulta agregada · cobro registrado en el Libro" : "Consulta agregada")
    } catch (e) {
      console.error("Error agregando consulta de traumatología", e)
      toast.error("No se pudo agregar la consulta")
    } finally {
      setSaving(false)
    }
  }

  const handleEliminar = async (id: string) => {
    setSaving(true)
    try {
      const lista = consultas.filter((c) => c.id !== id).map(materializarLegacy)
      await persistir(lista, `Eliminó una consulta de traumatología de ${patient.nombre} ${patient.apellido}`)
      setConsultas(parseConsultasTrauma({ consultas: lista }))
      setConfirmDeleteId(null)
      toast.success("Consulta eliminada")
    } catch (e) {
      console.error("Error eliminando consulta de traumatología", e)
      toast.error("No se pudo eliminar la consulta")
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

          {/* Historia de kinesiología — solo lectura. Acordeón cerrado por default:
              la ficha abre enfocada en trauma sin inundar de información. El
              historial libre (el bloque largo) se pliega aparte, adentro. */}
          <section>
            <button
              type="button"
              onClick={() => setKineOpen((v) => !v)}
              aria-expanded={kineOpen}
              className="group flex w-full items-center gap-1.5 text-left"
            >
              <Lock className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 transition-colors group-hover:text-slate-600">
                Historia de kinesiología · solo lectura
              </h3>
              {(tratamientos.length > 0 || !!historialLibre) && !kineOpen && (
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400/50" title="Tiene contenido" />
              )}
              <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-2">
                <span className="text-[11px] text-slate-300">
                  {tratamientos.length > 0
                    ? `${tratamientos.length} tratamiento${tratamientos.length !== 1 ? "s" : ""}`
                    : historialLibre
                    ? "historial libre"
                    : "sin registros"}
                </span>
                <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform duration-200 motion-reduce:transition-none ${kineOpen ? "" : "-rotate-90"}`} />
              </span>
            </button>

            <div className={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${kineOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
              <div className="overflow-hidden">
                <div className="space-y-2 pt-2">
                  {tratamientos.length === 0 && !historialLibre ? (
                    <p className="text-sm italic text-slate-400">Sin historia de kinesiología registrada.</p>
                  ) : (
                    <>
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
                        <div className="rounded-md border border-slate-200 bg-white">
                          <button
                            type="button"
                            onClick={() => setHistLibreOpen((v) => !v)}
                            aria-expanded={histLibreOpen}
                            className="group flex w-full items-center gap-1.5 p-2.5 text-left"
                          >
                            <span className="text-[11px] uppercase tracking-wide text-slate-400 transition-colors group-hover:text-slate-600">
                              Historial libre
                            </span>
                            {!histLibreOpen && (
                              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400/50" title="Tiene contenido" />
                            )}
                            <ChevronDown className={`ml-auto h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform duration-200 motion-reduce:transition-none ${histLibreOpen ? "" : "-rotate-90"}`} />
                          </button>
                          <div className={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${histLibreOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
                            <div className="overflow-hidden">
                              <p className="whitespace-pre-wrap break-words px-2.5 pb-2.5 font-mono text-xs text-slate-600">{historialLibre}</p>
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* Traumatología — historial de consultas (editable) */}
          <section className="space-y-4 rounded-lg border border-indigo-100 bg-indigo-50/40 p-4">
            <div className="flex items-center gap-1.5">
              <Bone className="h-4 w-4 text-indigo-600" />
              <h3 className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Traumatología</h3>
            </div>

            {/* Nueva consulta */}
            <div className="space-y-3 rounded-md border border-indigo-100 bg-white p-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Nueva consulta</p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <div className="space-y-1.5 sm:w-36">
                  <Label htmlFor="trauma-fecha" className="text-xs text-slate-600">
                    Fecha
                  </Label>
                  <Input
                    id="trauma-fecha"
                    type="date"
                    value={fecha}
                    onChange={(e) => setFecha(e.target.value)}
                    className="border-indigo-200 focus:border-indigo-500"
                  />
                </div>
                <div className="space-y-1.5 sm:w-32">
                  <Label htmlFor="trauma-monto" className="text-xs text-slate-600">
                    Importe <span className="text-slate-300">(opc.)</span>
                  </Label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-slate-400">$</span>
                    <Input
                      id="trauma-monto"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step={100}
                      value={monto}
                      onChange={(e) => setMonto(e.target.value)}
                      placeholder="0"
                      className="border-indigo-200 pl-6 focus:border-indigo-500"
                    />
                  </div>
                </div>
                <div className="flex-1 space-y-1.5">
                  <Label htmlFor="trauma-diag" className="text-xs text-slate-600">
                    Diagnóstico <span className="text-slate-300">(opcional)</span>
                  </Label>
                  <Input
                    id="trauma-diag"
                    value={diagnostico}
                    onChange={(e) => setDiagnostico(e.target.value)}
                    placeholder="Ej: Lumbalgia mecánica, gonartrosis…"
                    className="border-indigo-200 focus:border-indigo-500"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="trauma-notas" className="text-xs text-slate-600">
                  Notas / evolución
                </Label>
                <Textarea
                  id="trauma-notas"
                  value={notas}
                  onChange={(e) => setNotas(e.target.value)}
                  placeholder="Motivo de consulta, indicaciones, órdenes, evolución…"
                  className="min-h-[90px] border-indigo-200 text-sm focus:border-indigo-500"
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] text-slate-400">
                  {Number(monto) > 0
                    ? "Se registra un cobro en el Libro Diario (caja)."
                    : "Cargá un importe para registrar el cobro en la caja."}
                </p>
                <Button
                  type="button"
                  onClick={handleAgregar}
                  disabled={!notas.trim() || saving}
                  className="shrink-0 gap-1.5 bg-indigo-600 text-white hover:bg-indigo-700"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Agregar consulta
                </Button>
              </div>
            </div>

            {/* Historial de consultas */}
            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">
                Historial de consultas{consultas.length > 0 ? ` · ${consultas.length}` : ""}
              </p>
              {consultas.length === 0 ? (
                <p className="text-sm italic text-slate-400">Sin consultas registradas todavía.</p>
              ) : (
                <ol className="space-y-2">
                  {consultas.map((c) => (
                    <li key={c.id} className="rounded-md border border-slate-200 bg-white p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-indigo-700">{fmtFechaConsulta(c.fecha)}</p>
                          {c.diagnostico && <p className="mt-0.5 text-sm font-medium text-slate-700">{c.diagnostico}</p>}
                        </div>
                        {confirmDeleteId === c.id ? (
                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleEliminar(c.id)}
                              disabled={saving}
                              className="rounded p-1 text-red-600 hover:bg-red-50"
                              title="Confirmar eliminación"
                            >
                              <Check className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              disabled={saving}
                              className="rounded p-1 text-slate-400 hover:bg-slate-100"
                              title="Cancelar"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(c.id)}
                            className="shrink-0 rounded p-1 text-slate-300 hover:bg-red-50 hover:text-red-500"
                            title="Eliminar consulta"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-600">{c.notas}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        {typeof c.monto === "number" && c.monto > 0 && (
                          <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                            Cobrado ${c.monto.toLocaleString("es-AR")}
                          </span>
                        )}
                        {c.usuario && <span className="text-[11px] text-slate-400">Registró: {c.usuario}</span>}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </section>

          <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
              Cerrar
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
