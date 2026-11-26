"use client"

import { useState } from "react"
import { fusionarPacientes, deshacerFusion, type GrupoDuplicado } from "@/lib/dedup"
import { getSessionStats } from "@/lib/domain/paciente"
import { Patient } from "@/types"
import { PreviewPatientPanel } from "@/components/preview-patient-panel"
import { Button } from "@/components/ui/button"
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
import { toast } from "sonner"
import { GitMerge, AlertTriangle, ChevronLeft, ChevronRight, Loader2, UserCheck, SearchCheck, PencilLine } from "lucide-react"

const PAGE_SIZE = 10

function sesionesCount(p: Patient): number {
  const s = getSessionStats(p)
  if (s) return s.used
  const txt = Array.isArray(p.sesiones) ? p.sesiones.join(" ") : String(p.sesiones ?? "")
  return [...txt.matchAll(/\d+-(?=\s|$)/g)].length
}

// Sugerencia de cuál conservar: el de más sesiones cargadas; desempate por última edición
function mejorKeeper(g: GrupoDuplicado): string {
  return [...g.pacientes].sort((a, b) => {
    const d = sesionesCount(b) - sesionesCount(a)
    if (d !== 0) return d
    return (b.ultima_actualizacion?.fecha ?? "").localeCompare(a.ultima_actualizacion?.fecha ?? "")
  })[0].id
}

/**
 * Depuración asistida de fichas duplicadas. Vive dentro de la Recepción (la usan
 * las administrativas, no solo el admin): el encabezado, el contador y el estado
 * "sin duplicados" los pone la sección que lo contiene, así que acá va solo el
 * contenido accionable. Los `grupos` llegan por prop — el padre ya los computó
 * sobre `usePatients()`, así que no hay lectura ni recálculo extra.
 */
export function PacientesDuplicados({
  grupos: todos,
  onAbrirFicha,
}: {
  grupos: GrupoDuplicado[]
  /** Abre la ficha para corregir el DNI (grupos de personas distintas) */
  onAbrirFicha?: (patientId: string) => void
}) {
  // Primero lo fácil: "misma persona" (fusión segura). "Revisar" = nombres que no
  // coinciden → casi siempre DNI mal cargado; se corrige, no se fusiona.
  const mismas = todos.filter((g) => g.tipo === "misma_persona")
  const revisar = todos.filter((g) => g.tipo === "revisar")
  const [vista, setVista] = useState<"misma_persona" | "revisar">(mismas.length > 0 ? "misma_persona" : "revisar")
  const grupos = vista === "misma_persona" ? mismas : revisar
  const [confirmaMismaPersona, setConfirmaMismaPersona] = useState(false)
  const [page, setPage] = useState(1)
  const [keepSel, setKeepSel] = useState<Record<string, string>>({}) // dni → keepId elegido
  const [confirmGrupo, setConfirmGrupo] = useState<GrupoDuplicado | null>(null)
  const [merging, setMerging] = useState(false)
  const [preview, setPreview] = useState<Patient | null>(null)

  const keepIdDe = (g: GrupoDuplicado) => keepSel[g.dni] ?? mejorKeeper(g)

  const totalPages = Math.max(1, Math.ceil(grupos.length / PAGE_SIZE))
  const pageClamped = Math.min(page, totalPages)
  const start = (pageClamped - 1) * PAGE_SIZE
  const visibles = grupos.slice(start, start + PAGE_SIZE)

  const doFusion = async (g: GrupoDuplicado) => {
    const keepId = keepIdDe(g)
    const keep = g.pacientes.find((p) => p.id === keepId)
    if (!keep) return
    const drops = g.pacientes.filter((p) => p.id !== keepId)
    setMerging(true)
    try {
      const { revert } = await fusionarPacientes(keep, drops)
      const nombre = `${keep.nombre} ${keep.apellido}`.trim()
      toast.success(`Fichas fusionadas en ${nombre}`, {
        duration: 8000,
        action: {
          label: "Deshacer",
          onClick: async () => {
            try {
              await deshacerFusion(revert, { nombre, entidadId: keep.id })
              toast.success("Fusión deshecha")
            } catch {
              toast.error("No se pudo deshacer la fusión")
            }
          },
        },
      })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al fusionar")
    } finally {
      setMerging(false)
      setConfirmGrupo(null)
    }
  }

  return (
    <div className="space-y-3 px-4 py-4">
      <div className="flex flex-wrap gap-2">
        {([
          { k: "misma_persona", label: "Misma persona", n: mismas.length, Icon: UserCheck, on: "bg-emerald-600 text-white border-emerald-600" },
          { k: "revisar", label: "Revisar DNI", n: revisar.length, Icon: SearchCheck, on: "bg-amber-500 text-white border-amber-500" },
        ] as const).map(({ k, label, n, Icon, on }) => (
          <button
            key={k}
            type="button"
            onClick={() => { setVista(k); setPage(1) }}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              vista === k ? on : "border-slate-200 text-slate-600 hover:border-slate-300"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
            <span className="tabular-nums opacity-80">({n})</span>
          </button>
        ))}
      </div>

      {vista === "misma_persona" ? (
        <div className="flex items-start gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-emerald-800 text-xs">
          <UserCheck className="h-4 w-4 shrink-0 text-emerald-600 mt-0.5" />
          <span>
            Mismo DNI y mismo nombre: es <strong>la misma persona cargada dos veces</strong>. Fusionalas: queda la ficha
            marcada en verde (la de más sesiones), los historiales se unen y los turnos pasan a esa ficha. No se pierde nada.
          </span>
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-amber-800 text-xs">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500 mt-0.5" />
          <span>
            Mismo DNI pero <strong>nombres distintos</strong>: casi siempre son dos personas diferentes y uno de los DNI está
            mal cargado. <strong>No las fusiones</strong>: tocá &ldquo;Corregir DNI&rdquo; en la ficha equivocada (confirmalo con la
            orden médica o preguntándole al paciente).
          </span>
        </div>
      )}

      {grupos.length === 0 && (
        <p className="py-6 text-center text-sm text-slate-400">No quedan grupos en esta lista 🎉</p>
      )}

      <div className="space-y-3">
        {visibles.map((g) => {
          const keepId = keepIdDe(g)
          return (
            <div key={g.dni} className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs font-mono bg-slate-100 text-slate-600 px-2 py-0.5 rounded">DNI {g.dni}</span>
                <span className="text-xs text-slate-400">{g.pacientes.length} fichas</span>
                {g.tipo === "revisar" && (
                  <span className="text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                    nombres distintos
                  </span>
                )}
              </div>

              <div className="space-y-1.5">
                {g.pacientes.map((p) => {
                  const isKeep = keepId === p.id
                  const isPreviewing = preview?.id === p.id
                  return (
                    <label
                      key={p.id}
                      onClick={() => setPreview(p)}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-[color,background-color,border-color,box-shadow] duration-200 ease-[var(--ease-out)] ${
                        isKeep ? "border-emerald-300 bg-emerald-50" : "border-slate-200 hover:bg-slate-50"
                      } ${isPreviewing ? "ring-2 ring-[#001633]/30" : ""}`}
                    >
                      <input
                        type="radio"
                        name={`keep-${g.dni}`}
                        checked={isKeep}
                        onChange={() => setKeepSel((s) => ({ ...s, [g.dni]: p.id }))}
                        className="accent-emerald-600 shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-800 truncate">
                          {p.nombre} {p.apellido}
                        </p>
                        <p className="text-xs text-slate-400 truncate">
                          {sesionesCount(p)} ses.
                          {p.telefono ? ` · ${p.telefono}` : ""}
                          {p.obraSocial && p.obraSocial !== "-" ? ` · ${p.obraSocial}` : ""}
                        </p>
                      </div>
                      {g.tipo === "revisar" && onAbrirFicha ? (
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onAbrirFicha(p.id) }}
                          className="inline-flex items-center gap-1 shrink-0 rounded-md border border-amber-300 bg-white px-2 py-1 text-[11px] font-medium text-amber-800 hover:bg-amber-50"
                        >
                          <PencilLine className="h-3 w-3" />
                          Corregir DNI
                        </button>
                      ) : (
                        isKeep && <span className="text-[11px] text-emerald-700 font-medium shrink-0">se conserva</span>
                      )}
                    </label>
                  )
                })}
              </div>

              {/* La vista previa es un panel fixed que cubre ~448px del borde
                  derecho. En pantallas angostas (< md) el botón se desliza a
                  la izquierda para no quedar tapado; desde md el panel reserva
                  su ancho en el body (ver PreviewPatientPanel) y no hace falta. Posición absoluta + transición de left/translateX =
                  glide horizontal con la curva de salida del proyecto; el alto
                  del contenedor (h-9 = botón sm) reserva el espacio. motion-reduce
                  lo deja saltar sin animar. */}
              <div className="relative mt-3 h-9">
                <div
                  className={`absolute top-0 transition-[left,transform] duration-300 ease-[var(--ease-out)] motion-reduce:transition-none ${
                    preview ? "left-0 translate-x-0 md:left-full md:-translate-x-full" : "left-full -translate-x-full"
                  }`}
                >
                  <Button
                    size="sm"
                    variant={g.tipo === "revisar" ? "outline" : "default"}
                    onClick={() => { setConfirmaMismaPersona(false); setConfirmGrupo(g) }}
                    className={g.tipo === "revisar"
                      ? "gap-1.5 border-slate-300 text-slate-600"
                      : "bg-[#001633] hover:bg-[#002966] gap-1.5"}
                  >
                    <GitMerge className="h-3.5 w-3.5" />
                    {g.tipo === "revisar" ? "Fusionar igual" : "Fusionar"}
                  </Button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 text-xs text-slate-500">
          <Button size="sm" variant="outline" className="h-7 w-7 p-0" disabled={pageClamped === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span>{pageClamped} / {totalPages}</span>
          <Button size="sm" variant="outline" className="h-7 w-7 p-0" disabled={pageClamped === totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      <AlertDialog open={confirmGrupo !== null} onOpenChange={(o) => !o && setConfirmGrupo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Fusionar estas fichas?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmGrupo && (() => {
                const keep = confirmGrupo.pacientes.find((p) => p.id === keepIdDe(confirmGrupo))
                const n = confirmGrupo.pacientes.length - 1
                return (
                  <>
                    Se conserva <span className="font-medium">{keep?.nombre} {keep?.apellido}</span> y se{" "}
                    {n === 1 ? "elimina la otra ficha" : `eliminan las otras ${n} fichas`}. Los historiales se concatenan
                    y los turnos se reasignan. Podés deshacerlo desde el aviso.
                    {confirmGrupo.tipo === "revisar" && (
                      <label className="mt-3 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-amber-900 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={confirmaMismaPersona}
                          onChange={(e) => setConfirmaMismaPersona(e.target.checked)}
                          className="mt-0.5 accent-amber-600"
                        />
                        <span>
                          Los nombres no coinciden. Confirmo que verifiqué que <strong>es la misma persona</strong> (el nombre
                          estaba mal escrito), no dos pacientes distintos.
                        </span>
                      </label>
                    )}
                  </>
                )
              })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={merging}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={merging || (confirmGrupo?.tipo === "revisar" && !confirmaMismaPersona)}
              onClick={(e) => { e.preventDefault(); if (confirmGrupo) doFusion(confirmGrupo) }}
              className="bg-[#001633] hover:bg-[#002966]"
            >
              {merging ? (<><Loader2 className="h-4 w-4 animate-spin" />Fusionando...</>) : "Fusionar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PreviewPatientPanel patient={preview} onClose={() => setPreview(null)} />
    </div>
  )
}
