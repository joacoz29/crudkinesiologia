"use client"

import { useMemo, useState } from "react"
import { formatInTimeZone } from "date-fns-tz"
import { Inbox, Check, Eye, RotateCcw, Mail, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useCachedMonth, setCachedMonth } from "@/lib/monthly-cache"
import {
  fetchSugerenciasMes,
  marcarSugerencia,
  TIPO_SUGERENCIA_LABEL,
  type EstadoSugerencia,
  type Sugerencia,
} from "@/lib/data/sugerencias"
import { TZ } from "@/lib/domain/tiempo"
import { toast } from "sonner"

const TIPO_STYLE: Record<Sugerencia["tipo"], string> = {
  mejora: "bg-emerald-50 text-emerald-700 border-emerald-200",
  problema: "bg-red-50 text-red-700 border-red-200",
  otro: "bg-slate-50 text-slate-600 border-slate-200",
}

const ESTADO_LABEL: Record<EstadoSugerencia, string> = { nueva: "Nueva", leida: "Leída", resuelta: "Resuelta" }

const PESTANA_LABEL: Record<string, string> = {
  pacientes: "Pacientes",
  libroDiario: "Libro Diario",
  calendario: "Calendario",
  pendientes: "Recepción",
  admin: "Admin",
}
const pestanaLabel = (p?: string) => (p ? PESTANA_LABEL[p] ?? p.charAt(0).toUpperCase() + p.slice(1) : null)

type Filtro = "todas" | EstadoSugerencia

export function AdminSugerencias({ mesKey, esMesActual }: { mesKey: string; esMesActual: boolean }) {
  const cacheKey = `sugerencias/${mesKey}`
  // Misma clave que usa Anita para el contador de nuevas → caché compartida
  const { data, isLoading } = useCachedMonth<Sugerencia[]>(cacheKey, () => fetchSugerenciasMes(mesKey), {
    revalidate: esMesActual,
    fallback: [],
  })
  const [cambios, setCambios] = useState<Record<string, EstadoSugerencia>>({})
  const [guardando, setGuardando] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<Filtro>("todas")

  const lista = useMemo(() => data.map((s) => (cambios[s.id] ? { ...s, estado: cambios[s.id] } : s)), [data, cambios])
  const cuenta = (e: EstadoSugerencia) => lista.filter((s) => s.estado === e).length
  const visibles = filtro === "todas" ? lista : lista.filter((s) => s.estado === filtro)

  const cambiarEstado = async (s: Sugerencia, estado: EstadoSugerencia) => {
    setGuardando(s.id)
    try {
      await marcarSugerencia(mesKey, s.id, estado)
      setCambios((c) => ({ ...c, [s.id]: estado }))
      setCachedMonth(cacheKey, data.map((x) => (x.id === s.id ? { ...x, estado } : x)))
    } catch {
      toast.error("No se pudo actualizar la sugerencia")
    } finally {
      setGuardando(null)
    }
  }

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-16 text-center text-sm text-slate-400 shadow-sm">
        Cargando...
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {([
          ["todas", `Todas (${lista.length})`],
          ["nueva", `Nuevas (${cuenta("nueva")})`],
          ["leida", `Leídas (${cuenta("leida")})`],
          ["resuelta", `Resueltas (${cuenta("resuelta")})`],
        ] as const).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setFiltro(k)}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              filtro === k ? "border-[#001633] bg-[#001633] text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {visibles.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-16 text-center text-sm text-slate-400 shadow-sm">
          <Inbox className="h-8 w-8 text-slate-300" />
          {lista.length === 0 ? "No llegaron sugerencias este mes." : "No hay sugerencias con este filtro."}
        </div>
      ) : (
        <div className="space-y-3">
          {visibles.map((s) => {
            const fecha = formatInTimeZone(new Date(s.creadoEn), TZ, "dd/MM/yyyy HH:mm")
            const desde = pestanaLabel(s.pestana)
            const ocupado = guardando === s.id
            return (
              <div
                key={s.id}
                className={`rounded-xl border bg-white p-4 shadow-sm ${s.estado === "nueva" ? "border-blue-200" : "border-slate-200"} ${
                  s.estado === "resuelta" ? "opacity-70" : ""
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${TIPO_STYLE[s.tipo]}`}>
                    {TIPO_SUGERENCIA_LABEL[s.tipo]}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 text-[11px] font-medium ${
                      s.estado === "nueva" ? "text-blue-700" : s.estado === "resuelta" ? "text-emerald-700" : "text-slate-500"
                    }`}
                  >
                    {s.estado === "nueva" && <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />}
                    {ESTADO_LABEL[s.estado]}
                  </span>
                  <span className="ml-auto text-xs text-slate-400">
                    {s.nombre} · {fecha} hs{desde ? ` · desde ${desde}` : ""}
                  </span>
                </div>

                <p className="mt-2.5 whitespace-pre-wrap break-words text-sm text-slate-700">{s.texto}</p>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {s.estado === "nueva" && (
                    <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={ocupado} onClick={() => cambiarEstado(s, "leida")}>
                      <Eye className="h-3.5 w-3.5" /> Marcar leída
                    </Button>
                  )}
                  {s.estado !== "resuelta" ? (
                    <Button
                      size="sm"
                      className="h-7 gap-1 bg-emerald-600 text-xs hover:bg-emerald-700"
                      disabled={ocupado}
                      onClick={() => cambiarEstado(s, "resuelta")}
                    >
                      <Check className="h-3.5 w-3.5" /> Resuelta
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={ocupado} onClick={() => cambiarEstado(s, "leida")}>
                      <RotateCcw className="h-3.5 w-3.5" /> Reabrir
                    </Button>
                  )}
                  <a
                    href={`mailto:${s.email}?subject=${encodeURIComponent("Sobre tu sugerencia en Kinesiología Integral")}`}
                    className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                  >
                    <Mail className="h-3.5 w-3.5" /> Responder
                  </a>
                  {ocupado && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
