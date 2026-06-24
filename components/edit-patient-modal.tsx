"use client"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
import { MessageCircle, RefreshCw, Trash2 } from "lucide-react"
import { useState, useEffect, useCallback, useMemo } from "react"
import { format as formatTZ } from "date-fns-tz"
import { format, parseISO, isValid } from "date-fns"
import { es } from "date-fns/locale"
import { ref, remove, update, get } from "firebase/database"
import { auth, db } from "@/lib/firebase"
import { addToLibroDiario, appendSesionAlHistorial, fetchTurnosPorPaciente, parseTratamientosRaw, writeLog, LogCambio } from "@/lib/helpers"
import { TratamientosAccordion } from "@/components/tratamientos-accordion"
import { Patient, Tratamiento, TurnoConFecha, TurnoEstado } from "@/types"
import { toast } from "sonner"
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

interface EditPatientModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  patient: Patient | null
  onSave: (updatedPatient: Patient) => Promise<boolean>
  setLibroDiarioUpdateTrigger: (value: (prev: number) => number) => void
}

const ESTADO_CHIP: Record<TurnoEstado, string> = {
  pendiente: "bg-blue-50 text-blue-700 border-blue-200",
  asistio: "bg-green-50 text-green-700 border-green-200",
  ausente: "bg-red-50 text-red-700 border-red-200",
  cancelado: "bg-gray-50 text-gray-500 border-gray-200",
}

function formatSesiones(text: string): string {
  return text.replace(/\s+(\d+-)/g, "\n$1").trim()
}

// Campos de texto editables del form (los mismos que se diffean para el audit log).
// A nivel módulo para compartirlos entre handleSave y la detección de "cambios sin
// guardar" (isDirty).
const CAMPOS_LABEL: Partial<Record<keyof Patient, string>> = {
  nombre: "Nombre", apellido: "Apellido", edad: "Edad", dni: "DNI",
  obraSocial: "Obra Social", nroAFL: "N°AFL", telefono: "Teléfono",
  domicilio: "Domicilio", anotaciones: "Anotaciones", sexo: "Sexo",
}

// Para diffs de textos largos en el log: muestra el final, que es donde se agregan sesiones
function resumirTexto(s: string, max = 120): string {
  const limpio = s.replace(/\n/g, " · ").trim()
  return limpio.length > max ? `…${limpio.slice(-max)}` : limpio || "—"
}

// Diff de tratamientos para el audit log: detecta altas, sesiones agregadas/quitadas/editadas
// y cambios de autorización/diagnóstico/doctor por tratamiento
function diffTratamientos(antes: Tratamiento[], despues: Tratamiento[], cambios: LogCambio) {
  const prevById = new Map(antes.map((t) => [t.id, t]))
  despues.forEach((t, i) => {
    const label = `Tratamiento ${i + 1}${t.nroAutorizacion ? ` (#${t.nroAutorizacion})` : ""}`
    const prev = prevById.get(t.id)
    if (!prev) {
      cambios[`${label} — nuevo`] = { antes: "—", despues: `${t.sesionesAutorizadas} sesiones autorizadas` }
      return
    }
    if (prev.sesionesAutorizadas !== t.sesionesAutorizadas) {
      cambios[`${label} — sesiones autorizadas`] = { antes: String(prev.sesionesAutorizadas), despues: String(t.sesionesAutorizadas) }
    }
    if (prev.sesiones.length !== t.sesiones.length) {
      cambios[`${label} — sesiones`] = { antes: `${prev.sesiones.length}`, despues: `${t.sesiones.length}` }
    } else if (JSON.stringify(prev.sesiones) !== JSON.stringify(t.sesiones)) {
      cambios[`${label} — sesiones`] = { antes: "—", despues: "texto de sesiones editado" }
    }
    const campos = [
      ["nroAutorizacion", "n° autorización"],
      ["diagnostico", "diagnóstico"],
      ["doctor", "doctor"],
      ["tratamiento", "descripción"],
    ] as const
    for (const [campo, lbl] of campos) {
      const a = String(prev[campo] ?? "")
      const d = String(t[campo] ?? "")
      if (a !== d) cambios[`${label} — ${lbl}`] = { antes: a || "—", despues: d || "—" }
    }
  })
  antes.forEach((t, i) => {
    if (!despues.some((d) => d.id === t.id)) {
      cambios[`Tratamiento ${i + 1}${t.nroAutorizacion ? ` (#${t.nroAutorizacion})` : ""}`] = {
        antes: `${t.sesiones.length}/${t.sesionesAutorizadas} sesiones`,
        despues: "eliminado",
      }
    }
  })
}


export function EditPatientModal({
  open,
  onOpenChange,
  patient,
  onSave,
  setLibroDiarioUpdateTrigger,
}: EditPatientModalProps) {
  const [editedPatient, setEditedPatient] = useState<Patient | null>(null)
  const [sesionesText, setSesionesText] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [turnos, setTurnos] = useState<TurnoConFecha[]>([])
  const [isLoadingTurnos, setIsLoadingTurnos] = useState(false)
  const [confirmDeleteAllOpen, setConfirmDeleteAllOpen] = useState(false)
  // Confirmación al cerrar la ficha con cambios sin guardar (ver isDirty).
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false)

  const [tratamientos, setTratamientos] = useState<Tratamiento[]>([])

  // Re-baja los turnos del paciente desde la base. Una sola lectura por rango
  // (misma que corre al abrir). `manual` = disparado por el botón Sincronizar:
  // avisa por toast y NO vacía la lista si falla (conserva lo que ya se ve).
  const reloadTurnos = useCallback(async (id: string, manual = false) => {
    setIsLoadingTurnos(true)
    try {
      const t = await fetchTurnosPorPaciente(id)
      setTurnos(t)
      if (manual) toast.success("Turnos sincronizados")
    } catch {
      if (manual) toast.error("No se pudieron sincronizar los turnos")
      else setTurnos([])
    } finally {
      setIsLoadingTurnos(false)
    }
  }, [])

  // Repuebla el form con los datos originales del paciente. Se usa al abrir y al
  // descartar cambios (toma el paciente por argumento para no depender de closures).
  const resetForm = useCallback((p: Patient) => {
    setEditedPatient(p)
    setSesionesText(formatSesiones((p.sesiones ?? []).join(" ")))
    setTratamientos(parseTratamientosRaw(p.tratamientos))
  }, [])

  useEffect(() => {
    if (!patient) return
    resetForm(patient)
    reloadTurnos(patient.id)
  }, [patient, reloadTurnos, resetForm])

  // ¿Hay ediciones sin guardar? Compara el estado del form contra el paciente
  // original. Misma lógica de comparación que usa handleSave para el diff del log,
  // así que es consistente (mismo criterio de "tocado").
  const isDirty = useMemo(() => {
    if (!patient || !editedPatient) return false
    const personalCambio = (Object.keys(CAMPOS_LABEL) as (keyof Patient)[]).some(
      (campo) => String(patient[campo] ?? "") !== String(editedPatient[campo] ?? ""),
    )
    const historialInicial = formatSesiones((patient.sesiones ?? []).join(" "))
    const historialCambio = sesionesText.trim() !== historialInicial
    const tratsCambio =
      JSON.stringify(tratamientos) !== JSON.stringify(parseTratamientosRaw(patient.tratamientos))
    return personalCambio || historialCambio || tratsCambio
  }, [patient, editedPatient, sesionesText, tratamientos])

  // Intercepta el cierre del modal (Esc, click afuera, botón X): si hay cambios sin
  // guardar pide confirmación en vez de descartarlos en silencio. El cierre que
  // dispara un guardado exitoso NO pasa por acá (lo controla el prop `open` desde el
  // padre), así que guardar nunca dispara este aviso.
  const handleOpenChange = (next: boolean) => {
    if (!next && isDirty && !isSaving) {
      setConfirmCloseOpen(true)
      return
    }
    onOpenChange(next)
  }

  const confirmDiscard = () => {
    setConfirmCloseOpen(false)
    if (patient) resetForm(patient)
    onOpenChange(false)
  }

  // Cerrar/recargar la pestaña con cambios sin guardar → prompt nativo del navegador.
  useEffect(() => {
    if (!open || !isDirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ""
    }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [open, isDirty])

  // "Hoy" en hora argentina (no UTC): después de las 21:00 el día UTC ya es mañana
  const hoyKey = formatTZ(new Date(), "yyyy-MM-dd", { timeZone: "America/Argentina/Buenos_Aires" })
  const turnosFuturos = turnos.filter((t) => t.fecha >= hoyKey)
  const pasadosPendientes = turnos.filter((t) => t.fecha < hoyKey && t.estado === "pendiente")
  const pasadosCount = turnos.length - turnosFuturos.length

  const handleDeleteTurno = async (turno: TurnoConFecha) => {
    try {
      await remove(ref(db, `turnos/${turno.fecha}/${turno.id}`))
      setTurnos((prev) => prev.filter((t) => t.id !== turno.id))
      toast.success("Turno eliminado")
      await writeLog({ accion: "eliminar_turno", detalle: `Eliminó turno de ${turno.nombre} ${turno.apellido} (${turno.fecha} ${turno.hora})`, entidadId: turno.id })
    } catch {
      toast.error("Error al eliminar el turno")
    }
  }

  // Elimina solo los turnos desde hoy en adelante; los previos quedan como registro
  // (los pendientes pasados se marcan cancelados). Una sola escritura multi-path.
  const handleDeleteAllTurnos = async () => {
    const nombrePaciente = `${editedPatient?.nombre ?? ""} ${editedPatient?.apellido ?? ""}`.trim()
    const turnosPrevios = turnos
    try {
      const updates: Record<string, unknown> = {}
      const revert: Record<string, unknown> = {}

      for (const t of turnosFuturos) {
        updates[`turnos/${t.fecha}/${t.id}`] = null
        // Nodo completo para poder restaurar con "Deshacer" (sin id/fecha ni undefined)
        const { id: _id, fecha: _fecha, ...nodo } = t
        revert[`turnos/${t.fecha}/${t.id}`] = Object.fromEntries(
          Object.entries(nodo).filter(([, v]) => v !== undefined)
        )
      }
      for (const t of pasadosPendientes) {
        updates[`turnos/${t.fecha}/${t.id}/estado`] = "cancelado"
        revert[`turnos/${t.fecha}/${t.id}/estado`] = "pendiente"
      }
      if (Object.keys(updates).length === 0) return

      await update(ref(db), updates)

      setTurnos(
        turnosPrevios
          .filter((t) => t.fecha < hoyKey)
          .map((t) => (t.estado === "pendiente" ? { ...t, estado: "cancelado" as TurnoEstado } : t))
      )

      const partes: string[] = []
      if (turnosFuturos.length > 0)
        partes.push(`${turnosFuturos.length} turno${turnosFuturos.length !== 1 ? "s" : ""} eliminado${turnosFuturos.length !== 1 ? "s" : ""} desde hoy`)
      if (pasadosPendientes.length > 0)
        partes.push(`${pasadosPendientes.length} previo${pasadosPendientes.length !== 1 ? "s" : ""} cancelado${pasadosPendientes.length !== 1 ? "s" : ""}`)

      toast.success(partes.join(" · "), {
        duration: 8000,
        action: {
          label: "Deshacer",
          onClick: async () => {
            try {
              await update(ref(db), revert)
              setTurnos(turnosPrevios)
              toast.success("Turnos restaurados")
              await writeLog({
                accion: "deshacer_eliminar_turnos",
                detalle: `Restauró ${turnosFuturos.length} turno${turnosFuturos.length !== 1 ? "s" : ""} de ${nombrePaciente}`,
              })
            } catch {
              toast.error("No se pudieron restaurar los turnos")
            }
          },
        },
      })

      await writeLog({
        accion: "eliminar_todos_turnos",
        detalle: `Eliminó ${turnosFuturos.length} turno${turnosFuturos.length !== 1 ? "s" : ""} desde hoy de ${nombrePaciente}${
          pasadosPendientes.length > 0
            ? ` y marcó ${pasadosPendientes.length} turno${pasadosPendientes.length !== 1 ? "s" : ""} previo${pasadosPendientes.length !== 1 ? "s" : ""} como cancelado`
            : ""
        }`,
      })
    } catch {
      toast.error("Error al eliminar los turnos")
    }
  }

  const handleSave = async () => {
    if (!editedPatient) return
    setIsSaving(true)
    try {
      // Anti lost-update: si mientras el modal estuvo abierto alguien confirmó una
      // asistencia (calendario), el snapshot local quedó viejo. Si el usuario NO
      // editó historial/tratamientos acá, conservamos lo que haya ahora en la base.
      const historialInicial = formatSesiones((patient?.sesiones ?? []).join(" "))
      const tratsIniciales = parseTratamientosRaw(patient?.tratamientos)
      const usuarioTocoHistorial = sesionesText.trim() !== historialInicial
      const usuarioTocoTrats = JSON.stringify(tratamientos) !== JSON.stringify(tratsIniciales)

      let sesionesFinales = sesionesText ? [sesionesText] : []
      let tratamientosFinales = tratamientos
      if (!usuarioTocoHistorial || !usuarioTocoTrats) {
        const freshSnap = await get(ref(db, `pacientes/${editedPatient.id}`))
        if (freshSnap.exists()) {
          const fresh = freshSnap.val() as Record<string, unknown>
          if (!usuarioTocoHistorial) {
            const rawSes = fresh.sesiones
            sesionesFinales = Array.isArray(rawSes)
              ? (rawSes as string[])
              : rawSes && typeof rawSes === "object"
              ? (Object.values(rawSes as object) as string[])
              : typeof rawSes === "string"
              ? [rawSes]
              : []
          }
          if (!usuarioTocoTrats) {
            tratamientosFinales = parseTratamientosRaw(fresh.tratamientos)
          }
        }
      }

      const latestTrat = tratamientosFinales.length > 0 ? tratamientosFinales[tratamientosFinales.length - 1] : null
      const updatedPatient: Patient = {
        ...editedPatient,
        tratamientos: tratamientosFinales,
        sesiones: sesionesFinales,
        sesionesAutorizadas: latestTrat?.sesionesAutorizadas ?? editedPatient.sesionesAutorizadas,
        nroAutorizacion: latestTrat?.nroAutorizacion || editedPatient.nroAutorizacion,
        diagnostico: latestTrat?.diagnostico || editedPatient.diagnostico,
        doctor: latestTrat?.doctor || editedPatient.doctor,
        ultima_actualizacion: {
          fecha: new Date().toISOString(),
          usuario: auth.currentUser?.displayName || auth.currentUser?.email || "Unknown",
        },
      }

      const cambios: LogCambio = {}
      for (const campo of Object.keys(CAMPOS_LABEL) as (keyof Patient)[]) {
        const antes = String(patient?.[campo] ?? "")
        const despues = String(updatedPatient[campo] ?? "")
        if (antes !== despues) cambios[CAMPOS_LABEL[campo]!] = { antes, despues }
      }

      // Diff del historial libre y de los tratamientos (sesiones, autorizaciones, etc.)
      if (usuarioTocoHistorial) {
        cambios["Historial"] = { antes: resumirTexto(historialInicial), despues: resumirTexto(sesionesText) }
      }
      diffTratamientos(tratsIniciales, tratamientos, cambios)

      // Primero el guardado real; el log y el libro diario solo si fue exitoso
      const guardado = await onSave(updatedPatient)
      if (!guardado) return

      // Los turnos guardan nombre/apellido copiados: si cambiaron, propagar a
      // todos los turnos cargados para que calendario y WhatsApp no muestren el viejo
      const nombreCambio =
        patient && (patient.nombre !== updatedPatient.nombre || patient.apellido !== updatedPatient.apellido)
      if (nombreCambio && turnos.length > 0) {
        const updates: Record<string, unknown> = {}
        for (const t of turnos) {
          updates[`turnos/${t.fecha}/${t.id}/nombre`] = updatedPatient.nombre
          updates[`turnos/${t.fecha}/${t.id}/apellido`] = updatedPatient.apellido
        }
        try {
          await update(ref(db), updates)
          setTurnos((prev) => prev.map((t) => ({ ...t, nombre: updatedPatient.nombre, apellido: updatedPatient.apellido })))
        } catch {
          toast.error("Paciente guardado, pero no se pudo actualizar el nombre en sus turnos")
        }
      }

      // Al libro diario solo si quedaron MÁS sesiones que al abrir (una sesión
      // agregada y luego borrada antes de guardar no debe generar entrada en la caja)
      const sesionesIniciales = tratsIniciales.reduce((s, t) => s + t.sesiones.length, 0)
      const sesionesActuales = tratamientos.reduce((s, t) => s + t.sesiones.length, 0)
      if (sesionesActuales > sesionesIniciales) {
        await addToLibroDiario({
          nombreApellido: `${updatedPatient.nombre} ${updatedPatient.apellido}`,
          obraSocial: updatedPatient.obraSocial,
        })
      }

      // Sin cambios reales → no ensuciar el audit log
      if (Object.keys(cambios).length > 0) {
        await writeLog({ accion: "editar_paciente", detalle: `Editó paciente ${updatedPatient.nombre} ${updatedPatient.apellido}`, entidadId: updatedPatient.id, cambios })
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error al guardar los cambios")
    } finally {
      setIsSaving(false)
    }
  }

  const handleWhatsApp = () => {
    if (!editedPatient) return
    const raw = editedPatient.telefono.replace(/\D/g, "")
    const phone = raw.startsWith("54") ? raw : raw.startsWith("0") ? `54${raw.slice(1)}` : `54${raw}`

    // Solo pendientes desde hoy: el fetch trae hasta 2 años atrás y no
    // tiene sentido "recordar" turnos que ya pasaron
    const pendientes = turnos
      .filter((t) => t.estado === "pendiente" && t.fecha >= hoyKey)
      .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.hora.localeCompare(b.hora))

    const lineas = pendientes.map((t) => {
      const d = parseISO(t.fecha)
      const label = isValid(d) ? format(d, "EEEE d 'de' MMMM", { locale: es }) : t.fecha
      return `• ${label.charAt(0).toUpperCase() + label.slice(1)} a las ${t.hora}`
    })

    const mensaje =
      `Hola ${editedPatient.nombre}, te recordamos tus turnos agendados:\n\n` +
      (lineas.length > 0 ? lineas.join("\n") : "No tenés turnos pendientes por el momento.") +
      "\n\n*Kinesiología Integral*\nLic. Ana Patricia Tullio\n📞 02320-659087"

    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(mensaje)}`, "_blank")
  }

  if (!editedPatient) return null


  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className="max-w-full sm:max-w-2xl max-h-[90vh] overflow-y-auto"
          // No autoenfocar el primer input al abrir: en mobile dispara el teclado
          // y tapa los datos. El teclado aparece recién al tocar un campo.
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Editar — {editedPatient.nombre} {editedPatient.apellido}</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-6"
            onSubmit={(e) => {
              e.preventDefault()
              handleSave()
            }}
          >
            {/* Datos personales */}
            <div className="space-y-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Datos personales</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="nombre">Nombre</Label>
                  <Input id="nombre" value={editedPatient.nombre} onChange={(e) => setEditedPatient({ ...editedPatient, nombre: e.target.value })} className="border-slate-200 focus:border-[#001633]" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="apellido">Apellido</Label>
                  <Input id="apellido" value={editedPatient.apellido} onChange={(e) => setEditedPatient({ ...editedPatient, apellido: e.target.value })} className="border-slate-200 focus:border-[#001633]" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Sexo</Label>
                <RadioGroup value={editedPatient.sexo || ""} onValueChange={(value) => setEditedPatient({ ...editedPatient, sexo: value })} className="flex gap-4">
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="dni">DNI</Label>
                  <Input id="dni" value={editedPatient.dni} onChange={(e) => setEditedPatient({ ...editedPatient, dni: e.target.value })} className="border-slate-200 focus:border-[#001633]" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edad">Edad</Label>
                  <Input id="edad" value={editedPatient.edad} onChange={(e) => setEditedPatient({ ...editedPatient, edad: e.target.value })} className="border-slate-200 focus:border-[#001633]" />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="domicilio">Domicilio</Label>
                <Input id="domicilio" value={editedPatient.domicilio || ""} onChange={(e) => setEditedPatient({ ...editedPatient, domicilio: e.target.value })} className="border-slate-200 focus:border-[#001633]" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="telefono">Teléfono</Label>
                <Input id="telefono" value={editedPatient.telefono} onChange={(e) => setEditedPatient({ ...editedPatient, telefono: e.target.value })} className="border-slate-200 focus:border-[#001633]" />
              </div>
            </div>

            {/* Cobertura */}
            <div className="space-y-4 border-t border-slate-100 pt-5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Cobertura</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="obra-social">Obra Social</Label>
                  <Input id="obra-social" value={editedPatient.obraSocial} onChange={(e) => setEditedPatient({ ...editedPatient, obraSocial: e.target.value })} className="border-slate-200 focus:border-[#001633]" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="afl">N°AFL</Label>
                  <Input id="afl" value={editedPatient.nroAFL} onChange={(e) => setEditedPatient({ ...editedPatient, nroAFL: e.target.value })} className="border-slate-200 focus:border-[#001633]" />
                </div>
              </div>
            </div>

            {/* Notas */}
            <div className="space-y-4 border-t border-slate-100 pt-5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Notas</h3>
              <div className="space-y-2">
                <Label htmlFor="anotaciones">Anotaciones</Label>
                <Textarea id="anotaciones" value={editedPatient.anotaciones || ""} onChange={(e) => setEditedPatient({ ...editedPatient, anotaciones: e.target.value })} className="min-h-[80px] border-slate-200 focus:border-[#001633]" />
              </div>
            </div>

            <TratamientosAccordion
              key={editedPatient.id}
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

            {/* Turnos agendados */}
            <div className="space-y-4 border-t border-slate-100 pt-5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Turnos agendados</h3>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-500">
                  {turnos.length > 0 ? `${turnos.length} turno${turnos.length !== 1 ? "s" : ""}` : ""}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-xs h-7 gap-1.5 border-slate-300 text-slate-600 hover:bg-slate-50"
                    onClick={() => editedPatient && reloadTurnos(editedPatient.id, true)}
                    disabled={isLoadingTurnos}
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${isLoadingTurnos ? "animate-spin" : ""}`} />
                    Sincronizar
                  </Button>
                  {editedPatient.telefono && !isLoadingTurnos && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="text-xs h-7 gap-1.5 border-green-300 text-green-700 hover:bg-green-50"
                      onClick={handleWhatsApp}
                    >
                      <MessageCircle className="h-3.5 w-3.5" />
                      WhatsApp
                    </Button>
                  )}
                  {(turnosFuturos.length > 0 || pasadosPendientes.length > 0) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-xs text-red-500 hover:text-red-700 h-7"
                      onClick={() => setConfirmDeleteAllOpen(true)}
                    >
                      Eliminar próximos
                    </Button>
                  )}
                </div>
              </div>

              {isLoadingTurnos ? (
                <p className="text-sm text-gray-400">Cargando...</p>
              ) : turnos.length === 0 ? (
                <p className="text-sm text-gray-400">Sin turnos agendados</p>
              ) : (
                <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                  {turnos.map((t) => {
                    const fechaDate = parseISO(t.fecha)
                    const fechaLabel = isValid(fechaDate) ? format(fechaDate, "EEE d 'de' MMM", { locale: es }) : t.fecha
                    return (
                      <div
                        key={`${t.fecha}-${t.id}`}
                        className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-md border border-gray-100 text-sm"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="text-gray-500 text-xs capitalize shrink-0">{fechaLabel}</span>
                          <span className="font-medium shrink-0">{t.hora}</span>
                          <span className={`text-xs px-1.5 py-0.5 rounded border shrink-0 ${ESTADO_CHIP[t.estado]}`}>
                            {t.estado === "asistio" ? "asistió" : t.estado}
                            {t.estado === "ausente" && t.justificado != null && (
                              <span className="ml-1 opacity-70">
                                {t.justificado ? "· just." : "· no just."}
                              </span>
                            )}
                          </span>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-red-400 hover:text-red-600 hover:bg-red-50 shrink-0"
                          onClick={() => handleDeleteTurno(t)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <Button
              type="submit"
              className="w-auto bg-[#001633] hover:bg-[#002966]"
              disabled={isSaving}
            >
              {isSaving ? "Guardando..." : "Guardar Cambios"}
            </Button>

            <div className="text-sm text-slate-400 mt-2">
              Última actualización: {editedPatient.ultima_actualizacion?.usuario || "N/A"} —{" "}
              {editedPatient.ultima_actualizacion?.fecha
                ? (() => {
                    const d = new Date(editedPatient.ultima_actualizacion!.fecha)
                    return isValid(d)
                      ? formatTZ(d, "dd/MM/yyyy HH:mm", { timeZone: "America/Argentina/Buenos_Aires" })
                      : editedPatient.ultima_actualizacion!.fecha
                  })()
                : "N/A"}
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDeleteAllOpen} onOpenChange={setConfirmDeleteAllOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar los turnos próximos?</AlertDialogTitle>
            <AlertDialogDescription>
              {turnosFuturos.length > 0
                ? `Se eliminarán ${turnosFuturos.length} turno${turnosFuturos.length !== 1 ? "s" : ""} desde hoy en adelante de ${editedPatient?.nombre} ${editedPatient?.apellido}. `
                : `${editedPatient?.nombre} ${editedPatient?.apellido} no tiene turnos próximos. `}
              {pasadosCount > 0 && (
                <>
                  Los {pasadosCount} turno{pasadosCount !== 1 ? "s" : ""} anteriores quedan registrados
                  {pasadosPendientes.length > 0 && (
                    <> ({pasadosPendientes.length} pendiente{pasadosPendientes.length !== 1 ? "s" : ""} pasará{pasadosPendientes.length !== 1 ? "n" : ""} a cancelado)</>
                  )}
                  .
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteAllTurnos} className="bg-red-600 hover:bg-red-700">
              Eliminar próximos
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmCloseOpen} onOpenChange={setConfirmCloseOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Descartar los cambios?</AlertDialogTitle>
            <AlertDialogDescription>
              Tenés cambios sin guardar en la ficha de {editedPatient.nombre} {editedPatient.apellido}.
              Si cerrás ahora se van a perder.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Seguir editando</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDiscard} className="bg-red-600 hover:bg-red-700">
              Descartar cambios
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
