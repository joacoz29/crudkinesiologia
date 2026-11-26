"use client"

import { useEffect, useMemo, useState } from "react"
import { formatInTimeZone } from "date-fns-tz"
import { X, GitMerge, PencilLine, ArrowRight, ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { usePatients } from "@/lib/patients-store"
import { gruposDuplicados } from "@/lib/dedup"
import { TZ } from "@/lib/domain/tiempo"

// Aviso amistoso para que recepción depure las fichas duplicadas: un personaje
// con un globo de texto (1 vez por día, por usuario) y un tutorial de 4 pasos.
// El conteo sale de usePatients (ya en memoria) → cero lecturas extra.
// localStorage solo guarda "ya lo vi hoy" y el conteo previo (para mostrar avance).

type Guardado = { dia: string; ultimo: number }

function leer(key: string): Guardado | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as Guardado) : null
  } catch {
    return null
  }
}

function guardar(key: string, v: Guardado) {
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch {}
}

function Kini({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 84 100" className={className} aria-hidden="true">
      {/* pelo de atrás */}
      <path d="M20 44 C18 22 30 14 42 14 C54 14 66 22 64 44 C64 54 60 60 56 62 L28 62 C24 60 20 54 20 44 Z" fill="#4A2E22" />
      {/* rodete */}
      <circle cx="42" cy="12" r="8" fill="#4A2E22" />
      {/* cuello */}
      <rect x="36" y="56" width="12" height="10" rx="3" fill="#E8B48F" />
      {/* ambo */}
      <path d="M14 100 C14 78 25 68 42 68 C59 68 70 78 70 100 Z" fill="#001633" />
      <path d="M35 68 L42 78 L49 68" fill="none" stroke="#E2E8F0" strokeWidth="2.5" strokeLinejoin="round" />
      {/* estetoscopio */}
      <path d="M33 70 C29 82 34 90 42 90 C50 90 55 82 51 70" fill="none" stroke="#94A3B8" strokeWidth="2" />
      <circle cx="42" cy="91" r="3" fill="#CBD5E1" stroke="#94A3B8" strokeWidth="1.5" />
      {/* cara */}
      <circle cx="42" cy="40" r="19" fill="#F2C7A5" />
      {/* flequillo */}
      <path d="M23 38 C24 26 32 20 42 20 C52 20 60 26 61 36 C54 34 48 28 46 24 C42 30 32 35 23 38 Z" fill="#4A2E22" />
      {/* ojos */}
      <ellipse cx="35" cy="42" rx="2.2" ry="2.8" fill="#1F2937" />
      <ellipse cx="49" cy="42" rx="2.2" ry="2.8" fill="#1F2937" />
      <circle cx="35.8" cy="41" r="0.8" fill="#fff" />
      <circle cx="49.8" cy="41" r="0.8" fill="#fff" />
      {/* cachetes y sonrisa */}
      <circle cx="30" cy="48" r="3" fill="#F28B82" opacity="0.45" />
      <circle cx="54" cy="48" r="3" fill="#F28B82" opacity="0.45" />
      <path d="M36 50 Q42 56 48 50" fill="none" stroke="#7C2D12" strokeWidth="2" strokeLinecap="round" />
      {/* brazo saludando */}
      <g className="kini-wave">
        <path d="M64 82 C72 76 76 66 74 58" fill="none" stroke="#001633" strokeWidth="8" strokeLinecap="round" />
        <circle cx="74" cy="54" r="5.5" fill="#F2C7A5" />
      </g>
    </svg>
  )
}

// Fichas de ejemplo (personas ficticias) para ilustrar el tutorial
function FichaMini({ nombre, detalle, tono = "neutral", accion }: {
  nombre: string
  detalle: string
  tono?: "neutral" | "conserva"
  accion?: React.ReactNode
}) {
  return (
    <div className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 ${tono === "conserva" ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-white"}`}>
      <span className={`h-3.5 w-3.5 shrink-0 rounded-full border-2 ${tono === "conserva" ? "border-emerald-600 bg-emerald-600 shadow-[inset_0_0_0_2px_white]" : "border-slate-300"}`} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-800">{nombre}</p>
        <p className="truncate text-xs text-slate-400">{detalle}</p>
      </div>
      {accion}
    </div>
  )
}

const DniTag = ({ extra }: { extra?: React.ReactNode }) => (
  <div className="flex items-center gap-2">
    <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-600">DNI 30.123.456</span>
    {extra}
  </div>
)

const PASOS: { titulo: string; texto: React.ReactNode; ilustracion: React.ReactNode }[] = [
  {
    titulo: "¿Qué es una ficha duplicada?",
    texto: (
      <>
        Es cuando un mismo DNI aparece en <strong>dos o más fichas</strong>. Así las sesiones y los turnos quedan
        repartidos, y nadie ve la historia completa del paciente.
      </>
    ),
    ilustracion: (
      <div className="space-y-2">
        <DniTag />
        <FichaMini nombre="Juan Pérez" detalle="12 ses. · IOMA" />
        <FichaMini nombre="JUAN PEREZ" detalle="3 ses. · IOMA" />
      </div>
    ),
  },
  {
    titulo: "Misma persona → Fusionar",
    texto: (
      <>
        Si el nombre coincide, es la misma persona cargada dos veces. Está en la lista <strong>&ldquo;Misma persona&rdquo;</strong>.
        Dejá marcada la ficha en verde (el sistema ya sugiere la de más sesiones) y tocá <strong>Fusionar</strong>: los
        historiales se unen y los turnos pasan a esa ficha. No se pierde nada.
      </>
    ),
    ilustracion: (
      <div className="space-y-2">
        <DniTag />
        <FichaMini nombre="Juan Pérez" detalle="12 ses. · IOMA" tono="conserva" accion={<span className="text-[11px] font-medium text-emerald-700">se conserva</span>} />
        <FichaMini nombre="JUAN PEREZ" detalle="3 ses. · IOMA" />
        <div className="flex justify-end">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-[#001633] px-3 py-1.5 text-xs font-medium text-white">
            <GitMerge className="h-3.5 w-3.5" /> Fusionar
          </span>
        </div>
      </div>
    ),
  },
  {
    titulo: "Nombres distintos → Corregir el DNI",
    texto: (
      <>
        Si los nombres no coinciden, son <strong>dos pacientes distintos</strong> y uno tiene el DNI mal cargado. Están en
        la lista <strong>&ldquo;Revisar DNI&rdquo;</strong>. <strong>No los fusiones</strong>: tocá <strong>Corregir DNI</strong> en la ficha
        equivocada y cargá el correcto (fijate en la orden médica o preguntale al paciente cuando venga).
      </>
    ),
    ilustracion: (
      <div className="space-y-2">
        <DniTag extra={<span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">nombres distintos</span>} />
        <FichaMini nombre="Juan Pérez" detalle="12 ses. · IOMA" />
        <FichaMini
          nombre="Lucía Fernández"
          detalle="5 ses. · PAMI"
          accion={
            <span className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-white px-2 py-1 text-[11px] font-medium text-amber-800 ring-2 ring-amber-300/60">
              <PencilLine className="h-3 w-3" /> Corregir DNI
            </span>
          }
        />
      </div>
    ),
  },
  {
    titulo: "Tranqui: se puede deshacer",
    texto: (
      <>
        Después de fusionar aparece un aviso con <strong>Deshacer</strong> durante unos segundos, y todo queda registrado.
        Consejo: arrancá por <strong>&ldquo;Misma persona&rdquo;</strong>, que son las más rápidas. ¡De a poco se terminan!
      </>
    ),
    ilustracion: (
      <div className="flex justify-center py-3">
        <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm shadow-md">
          <span className="text-emerald-600">✓</span>
          <span className="text-slate-700">Fichas fusionadas en Juan Pérez</span>
          <span className="rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white">Deshacer</span>
        </div>
      </div>
    ),
  },
]

export function AvisoDuplicados({
  userEmail,
  userName,
  oculto,
  onIrARevisar,
}: {
  userEmail: string | null
  userName: string | null
  /** No mostrar (p. ej. ya está en Recepción, o el rol no gestiona fichas) */
  oculto: boolean
  onIrARevisar: () => void
}) {
  const { patients, isLoading } = usePatients()
  const grupos = useMemo(() => gruposDuplicados(patients), [patients])
  const total = grupos.length
  const faciles = grupos.filter((g) => g.tipo === "misma_persona").length

  const [visible, setVisible] = useState(false)
  const [previo, setPrevio] = useState<number | null>(null)
  const [tutorialOpen, setTutorialOpen] = useState(false)
  const [paso, setPaso] = useState(0)

  const storageKey = userEmail ? `kine-aviso-duplicados:${userEmail}` : null

  useEffect(() => {
    if (!storageKey) return
    const g = leer(storageKey)
    const hoy = formatInTimeZone(new Date(), TZ, "yyyy-MM-dd")
    setVisible(g?.dia !== hoy)
    setPrevio(g?.ultimo ?? null)
  }, [storageKey])

  const posponer = () => {
    if (storageKey) guardar(storageKey, { dia: formatInTimeZone(new Date(), TZ, "yyyy-MM-dd"), ultimo: total })
    setVisible(false)
  }

  const irARevisar = () => {
    setTutorialOpen(false)
    posponer()
    onIrARevisar()
  }

  if (isLoading || total === 0) return null

  const nombre = (userName ?? "").split(" ")[0]
  const avance = previo !== null && previo > total ? previo - total : 0
  const ultimoPaso = paso === PASOS.length - 1

  return (
    <>
      {visible && !oculto && !tutorialOpen && (
        <div className="fixed bottom-4 right-4 z-40 flex items-end gap-1 print:hidden sm:bottom-6 sm:right-6">
          <div
            role="status"
            className="kini-bubble relative mb-10 w-64 rounded-2xl rounded-br-sm border border-slate-200 bg-white p-3.5 shadow-xl sm:w-72"
          >
            <button
              type="button"
              onClick={posponer}
              aria-label="Cerrar hasta mañana"
              className="absolute right-2 top-2 rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-3.5 w-3.5" />
            </button>
            <p className="pr-5 text-sm font-semibold text-[#001633]">¡Hola{nombre ? ` ${nombre}` : ""}! 👋</p>
            {avance > 0 && (
              <p className="mt-1 text-xs font-medium text-emerald-700">
                ¡Bien ahí! Desde la última vez se resolvieron {avance} 🎉
              </p>
            )}
            <p className="mt-1 text-sm text-slate-600">
              Recuerden revisar las <strong>fichas duplicadas</strong>: quedan <strong className="tabular-nums">{total}</strong>
              {faciles > 0 && <> y {faciles} son fáciles de resolver</>}.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <Button
                size="sm"
                className="h-8 bg-[#001633] text-xs hover:bg-[#002966]"
                onClick={() => { setPaso(0); setTutorialOpen(true) }}
              >
                Ver cómo se hace
              </Button>
              <Button size="sm" variant="ghost" className="h-8 text-xs text-slate-500" onClick={posponer}>
                Mañana
              </Button>
            </div>
          </div>
          <button
            type="button"
            onClick={() => { setPaso(0); setTutorialOpen(true) }}
            aria-label="Ver cómo revisar las fichas duplicadas"
            className="kini-float shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#001633]/40"
          >
            <Kini className="h-24 w-20 drop-shadow-lg sm:h-28 sm:w-24" />
          </button>
        </div>
      )}

      <Dialog open={tutorialOpen} onOpenChange={setTutorialOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <Kini className="h-14 w-12 shrink-0" />
              <div className="min-w-0">
                <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
                  Paso {paso + 1} de {PASOS.length}
                </p>
                <DialogTitle className="text-[#001633]">{PASOS[paso].titulo}</DialogTitle>
              </div>
            </div>
          </DialogHeader>

          <div className="rounded-xl bg-slate-50 p-3">{PASOS[paso].ilustracion}</div>
          <DialogDescription className="text-sm leading-relaxed text-slate-600">{PASOS[paso].texto}</DialogDescription>

          <div className="flex items-center justify-between pt-1">
            <div className="flex gap-1.5" aria-hidden="true">
              {PASOS.map((_, i) => (
                <span key={i} className={`h-1.5 rounded-full transition-all ${i === paso ? "w-5 bg-[#001633]" : "w-1.5 bg-slate-300"}`} />
              ))}
            </div>
            <div className="flex gap-2">
              {paso > 0 && (
                <Button variant="outline" size="sm" onClick={() => setPaso((p) => p - 1)} className="gap-1">
                  <ArrowLeft className="h-3.5 w-3.5" /> Atrás
                </Button>
              )}
              {ultimoPaso ? (
                <Button size="sm" onClick={irARevisar} className="gap-1 bg-emerald-600 hover:bg-emerald-700">
                  Ir a revisar <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              ) : (
                <Button size="sm" onClick={() => setPaso((p) => p + 1)} className="gap-1 bg-[#001633] hover:bg-[#002966]">
                  Siguiente <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
