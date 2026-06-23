"use client"

import * as DialogPrimitive from "@radix-ui/react-dialog"
import { useEffect, useState, type ReactNode } from "react"
import { format, isValid } from "date-fns"
import { format as formatTZ } from "date-fns-tz"
import { Eye, X } from "lucide-react"
import { parseTratamientosRaw } from "@/lib/helpers"
import { sessionBadgeClass } from "@/components/tratamientos-accordion"
import { Patient } from "@/types"
import { cn } from "@/lib/utils"

interface PreviewPatientPanelProps {
  /** Paciente a previsualizar; `null` = panel cerrado */
  patient: Patient | null
  onClose: () => void
}

// "Historial libre" se guarda como string[]; lo unimos y partimos por "N-" para
// que cada sesión quede en su renglón (mismo formato que el modal de edición).
function formatSesiones(sesiones: string[] | undefined): string {
  return (sesiones ?? []).join(" ").replace(/\s+(\d+-)/g, "\n$1").trim()
}

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

function Field({ label, value, className }: { label: string; value?: string | number | null; className?: string }) {
  const filled = value !== undefined && value !== null && value !== ""
  return (
    <div className={cn("min-w-0 space-y-0.5", className)}>
      <p className="text-xs font-medium text-slate-400">{label}</p>
      <p className="text-sm text-slate-800 break-words">{filled ? String(value) : "—"}</p>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-3 border-t border-slate-100 pt-5 first:border-t-0 first:pt-0">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h3>
      {children}
    </div>
  )
}

// Panel lateral de SOLO LECTURA para comparar fichas duplicadas antes de fusionar.
// Es deliberadamente NO modal (sin overlay que bloquee): la lista de duplicados
// queda visible y clickeable, así al tocar otra tarjeta el panel se actualiza sin
// cerrarse. Renderiza únicamente datos ya en memoria (usePatients) → cero lecturas
// extra a RTDB. No incluye "Turnos agendados" a propósito: es lo único del modal de
// edición que requiere una lectura por ficha y no aporta a verificar la identidad.
export function PreviewPatientPanel({ patient, onClose }: PreviewPatientPanelProps) {
  const open = patient !== null
  // Retiene la última ficha mostrada para que la animación de salida no quede en
  // blanco cuando `patient` vuelve a null.
  const [shown, setShown] = useState<Patient | null>(patient)
  useEffect(() => {
    if (patient) setShown(patient)
  }, [patient])

  const display = patient ?? shown
  const tratamientos = display ? parseTratamientosRaw(display.tratamientos) : []
  const historial = formatSesiones(display?.sesiones)

  const ua = display?.ultima_actualizacion
  const uaFecha = ua?.fecha
    ? (() => {
        const d = new Date(ua.fecha)
        return isValid(d) ? formatTZ(d, "dd/MM/yyyy HH:mm", { timeZone: "America/Argentina/Buenos_Aires" }) : ua.fecha
      })()
    : null

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && onClose()} modal={false}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          // Solo lectura y comparación: no robar el foco al abrir ni devolverlo al
          // cerrar, y no cerrar al tocar fuera (tocar otra tarjeta debe ACTUALIZAR
          // el panel, no descartarlo). Se cierra con la X o con Escape.
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          aria-describedby={undefined}
          className={cn(
            "fixed inset-y-0 right-0 z-50 flex h-full w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right",
            "data-[state=closed]:duration-300 data-[state=open]:duration-500",
          )}
        >
          {display && (
            <>
              {/* Encabezado fijo */}
              <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-slate-400">
                    <Eye className="h-3.5 w-3.5" />
                    <span className="text-[11px] font-medium uppercase tracking-wide">Vista previa · solo lectura</span>
                  </div>
                  <DialogPrimitive.Title className="mt-1 truncate text-lg font-semibold text-[#001633]">
                    {display.nombre} {display.apellido}
                  </DialogPrimitive.Title>
                  <p className="font-mono text-xs text-slate-500">DNI {display.dni || "—"}</p>
                </div>
                <DialogPrimitive.Close className="-mr-1 shrink-0 rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#001633]">
                  <X className="h-5 w-5" />
                  <span className="sr-only">Cerrar vista previa</span>
                </DialogPrimitive.Close>
              </div>

              {/* Cuerpo desplazable */}
              <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
                <Section title="Datos personales">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    <Field label="Nombre" value={display.nombre} />
                    <Field label="Apellido" value={display.apellido} />
                    <Field label="Sexo" value={display.sexo ? cap(display.sexo) : ""} />
                    <Field label="Edad" value={display.edad} />
                    <Field label="DNI" value={display.dni} />
                    <Field label="Teléfono" value={display.telefono} />
                    <Field label="Domicilio" value={display.domicilio} className="col-span-2" />
                  </div>
                </Section>

                <Section title="Cobertura">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    <Field label="Obra Social" value={display.obraSocial} />
                    <Field label="N°AFL" value={display.nroAFL} />
                  </div>
                </Section>

                <Section title="Notas">
                  <p className="whitespace-pre-wrap text-sm text-slate-800">{display.anotaciones || "—"}</p>
                </Section>

                <Section title="Tratamientos">
                  {tratamientos.length === 0 ? (
                    <p className="text-sm text-slate-400">Sin tratamientos registrados</p>
                  ) : (
                    <div className="space-y-2">
                      {tratamientos.map((t, i) => {
                        const fechaDate = new Date(t.fechaCreacion)
                        const fechaLabel = isValid(fechaDate) ? format(fechaDate, "dd/MM/yyyy") : ""
                        return (
                          <div key={t.id} className="space-y-2 rounded-lg border border-slate-200 p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-medium text-slate-800">
                                  {t.nroAutorizacion ? `Autorización #${t.nroAutorizacion}` : `Tratamiento ${i + 1}`}
                                </span>
                                <span
                                  className={cn(
                                    "rounded-full border px-1.5 py-0.5 text-[11px] font-medium",
                                    sessionBadgeClass(t.sesiones.length, t.sesionesAutorizadas),
                                  )}
                                >
                                  {t.sesiones.length}/{t.sesionesAutorizadas} sesiones
                                </span>
                              </div>
                              {fechaLabel && <span className="shrink-0 text-xs text-slate-400">{fechaLabel}</span>}
                            </div>
                            {(t.diagnostico || t.doctor) && (
                              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                                <Field label="Diagnóstico" value={t.diagnostico} />
                                <Field label="Doctor" value={t.doctor} />
                              </div>
                            )}
                            {t.tratamiento && <Field label="Tratamiento" value={t.tratamiento} />}
                            {t.sesiones.length > 0 && (
                              <div className="space-y-1">
                                <p className="text-xs font-medium text-slate-400">Sesiones</p>
                                <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
                                  {t.sesiones.map((s, si) => (
                                    <p
                                      key={si}
                                      className="rounded border border-slate-100 bg-slate-50 px-2 py-1 text-xs text-slate-600"
                                    >
                                      {s}
                                    </p>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </Section>

                <Section title="Historial libre">
                  {historial ? (
                    <pre className="whitespace-pre-wrap rounded-md border border-slate-100 bg-slate-50 p-3 font-mono text-xs text-slate-600">
                      {historial}
                    </pre>
                  ) : (
                    <p className="text-sm text-slate-400">—</p>
                  )}
                </Section>

                <p className="border-t border-slate-100 pt-4 text-xs text-slate-400">
                  Última actualización: {ua?.usuario || "N/A"}
                  {uaFecha ? ` — ${uaFecha}` : ""}
                </p>
              </div>
            </>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
