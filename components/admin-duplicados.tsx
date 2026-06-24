"use client"

import { useMemo, useState } from "react"
import { usePatients } from "@/lib/patients-store"
import { gruposDuplicados, fusionarPacientes, deshacerFusion, type GrupoDuplicado } from "@/lib/dedup"
import { getSessionStats } from "@/lib/helpers"
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
import { GitMerge, AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight } from "lucide-react"

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

export function AdminDuplicados() {
  const { patients, isLoading } = usePatients()
  const grupos = useMemo(() => gruposDuplicados(patients), [patients])
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

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 bg-white rounded-xl border border-slate-200 animate-pulse" />
        ))}
      </div>
    )
  }

  if (grupos.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-20 text-slate-400 bg-white rounded-xl border border-slate-200">
        <CheckCircle2 className="h-12 w-12 text-emerald-400" />
        <p className="font-medium text-slate-600">Sin duplicados</p>
        <p className="text-sm">No hay DNIs válidos compartidos por más de un paciente.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-[#001633]">Pacientes duplicados</h2>
        <p className="text-sm text-slate-500 mt-1">
          {grupos.length} grupo{grupos.length !== 1 ? "s" : ""} con el mismo DNI. Tocá una ficha para verla en detalle, elegí cuál conservar y fusioná.
        </p>
      </div>

      <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-amber-800 text-xs">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500 mt-0.5" />
        <span>
          Revisá cada grupo: a veces son <strong>dos personas distintas con el mismo DNI mal cargado</strong>. En ese
          caso NO fusiones — corregí el DNI desde Pacientes. Al fusionar, los historiales se concatenan (no se pierde
          nada) y los turnos se reasignan a la ficha que queda.
        </span>
      </div>

      <div className="space-y-3">
        {visibles.map((g) => {
          const keepId = keepIdDe(g)
          return (
            <div key={g.dni} className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs font-mono bg-slate-100 text-slate-600 px-2 py-0.5 rounded">DNI {g.dni}</span>
                <span className="text-xs text-slate-400">{g.pacientes.length} fichas</span>
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
                      {isKeep && <span className="text-[11px] text-emerald-700 font-medium shrink-0">se conserva</span>}
                    </label>
                  )
                })}
              </div>

              {/* La vista previa es un panel fixed que cubre ~448px del borde
                  derecho. Con una ficha abierta el botón se desliza a la
                  izquierda para no quedar tapado, y vuelve a la derecha al
                  cerrar. Posición absoluta + transición de left/translateX =
                  glide horizontal con la curva de salida del proyecto; el alto
                  del contenedor (h-9 = botón sm) reserva el espacio. motion-reduce
                  lo deja saltar sin animar. */}
              <div className="relative mt-3 h-9">
                <div
                  className={`absolute top-0 transition-[left,transform] duration-300 ease-[var(--ease-out)] motion-reduce:transition-none ${
                    preview ? "left-0 translate-x-0" : "left-full -translate-x-full"
                  }`}
                >
                  <Button
                    size="sm"
                    onClick={() => setConfirmGrupo(g)}
                    className="bg-[#001633] hover:bg-[#002966] gap-1.5"
                  >
                    <GitMerge className="h-3.5 w-3.5" />
                    Fusionar
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
                  </>
                )
              })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={merging}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={merging}
              onClick={(e) => { e.preventDefault(); if (confirmGrupo) doFusion(confirmGrupo) }}
              className="bg-[#001633] hover:bg-[#002966]"
            >
              {merging ? "Fusionando..." : "Fusionar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PreviewPatientPanel patient={preview} onClose={() => setPreview(null)} />
    </div>
  )
}
