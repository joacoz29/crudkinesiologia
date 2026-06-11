"use client"

import { useState } from "react"
import { Star, CheckCircle2, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

const KINESIOLOGOS = ["Ana Tullio", "Gonzalo González", "Camila Baldi"]

export default function OpinionPage() {
  const [dni, setDni] = useState("")
  const [rating, setRating] = useState(0)
  const [hoverRating, setHoverRating] = useState(0)
  const [atendidoPor, setAtendidoPor] = useState("")
  const [comentario, setComentario] = useState("")
  const [isSending, setIsSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState("")

  const dniValido = dni.replace(/\D/g, "").length >= 6
  const canSubmit = dniValido && rating >= 1 && !isSending

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setIsSending(true)
    setError("")
    try {
      const res = await fetch("/api/opinion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dni, rating, comentario, atendidoPor }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setSent(true)
      } else {
        setError(data.error ?? "No pudimos registrar tu opinión. Probá más tarde.")
      }
    } catch {
      setError("Error de conexión. Revisá tu internet y probá de nuevo.")
    } finally {
      setIsSending(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center px-4 py-8">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-2xl font-semibold text-[#001633]">Kinesiología Integral</h1>
          <p className="text-sm text-gray-500 mt-0.5">Lic. Ana Patricia Tullio</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
          {sent ? (
            <div className="text-center py-10">
              <CheckCircle2 className="h-14 w-14 text-green-500 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-[#001633] mb-2">¡Gracias por tu opinión!</h2>
              <p className="text-sm text-gray-500">
                Nos ayuda a mejorar la atención todos los días.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <h2 className="text-lg font-semibold text-[#001633] text-center">
                ¿Cómo fue tu atención?
              </h2>

              {/* DNI */}
              <div className="space-y-1.5">
                <Label htmlFor="dni">Tu DNI</Label>
                <Input
                  id="dni"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="Sin puntos, ej: 30123456"
                  value={dni}
                  onChange={(e) => setDni(e.target.value.replace(/[^\d.]/g, ""))}
                  className="border-gray-300 focus:border-[#001633] h-11 text-base"
                />
                <p className="text-xs text-gray-400">Solo para verificar que sos paciente — tu opinión es confidencial.</p>
              </div>

              {/* Estrellas */}
              <div className="space-y-1.5">
                <Label>Tu puntuación</Label>
                <div className="flex justify-center gap-2 py-1" onMouseLeave={() => setHoverRating(0)}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setRating(n)}
                      onMouseEnter={() => setHoverRating(n)}
                      className="p-1"
                      aria-label={`${n} estrella${n > 1 ? "s" : ""}`}
                    >
                      <Star
                        className={`h-9 w-9 transition-colors ${
                          n <= (hoverRating || rating)
                            ? "fill-amber-400 text-amber-400"
                            : "text-gray-300"
                        }`}
                      />
                    </button>
                  ))}
                </div>
              </div>

              {/* Quién atendió */}
              <div className="space-y-1.5">
                <Label>¿Quién te atendió? <span className="text-gray-400 font-normal text-xs">(opcional)</span></Label>
                <div className="flex flex-wrap gap-2">
                  {KINESIOLOGOS.map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setAtendidoPor(atendidoPor === k ? "" : k)}
                      className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                        atendidoPor === k
                          ? "bg-[#001633] text-white border-[#001633]"
                          : "border-gray-300 text-gray-600 hover:border-[#001633]"
                      }`}
                    >
                      {k}
                    </button>
                  ))}
                </div>
              </div>

              {/* Comentario */}
              <div className="space-y-1.5">
                <Label htmlFor="comentario">
                  Contanos más <span className="text-gray-400 font-normal text-xs">(opcional)</span>
                </Label>
                <Textarea
                  id="comentario"
                  value={comentario}
                  onChange={(e) => setComentario(e.target.value.slice(0, 500))}
                  placeholder="¿Qué te gustó? ¿Qué podemos mejorar?"
                  className="min-h-[88px] border-gray-300 focus:border-[#001633] text-base"
                />
              </div>

              {error && (
                <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}

              <Button
                type="submit"
                disabled={!canSubmit}
                className="w-full h-12 text-base bg-[#001633] hover:bg-[#002966]"
              >
                {isSending ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> Enviando...
                  </span>
                ) : (
                  "Enviar opinión"
                )}
              </Button>
            </form>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 mt-4">
          Tel: 02320-659087
        </p>
      </div>
    </div>
  )
}
