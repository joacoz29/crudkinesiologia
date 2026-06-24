"use client"

import { useEffect } from "react"
import { AlertTriangle, RotateCw } from "lucide-react"
import { Button } from "@/components/ui/button"

// Error boundary de la ruta (App Router): atrapa cualquier excepción de render en
// app/page.tsx y sus hijos. Con datos legacy/duplicados, una sola ficha malformada
// que rompa un render dejaba TODA la app en blanco; ahora cae acá con opción de
// reintentar (reset) sin recargar toda la página. NO atrapa errores del root
// layout (de eso se ocupa global-error.tsx).
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Queda en la consola del navegador / logs de Vercel para diagnóstico.
    console.error("Error no controlado en la app:", error)
  }, [error])

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center">
        <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-red-50 flex items-center justify-center">
          <AlertTriangle className="h-6 w-6 text-red-600" />
        </div>
        <h1 className="text-lg font-semibold text-[#001633]">Algo salió mal</h1>
        <p className="mt-2 text-sm text-slate-500">
          Ocurrió un error inesperado al mostrar esta sección. Tus datos están a
          salvo; podés reintentar o volver al inicio.
        </p>
        <div className="mt-6 flex gap-2 justify-center">
          <Button onClick={() => reset()} className="bg-[#001633] hover:bg-[#002966] gap-2">
            <RotateCw className="h-4 w-4" />
            Reintentar
          </Button>
          <Button variant="outline" onClick={() => window.location.assign("/")}>
            Volver al inicio
          </Button>
        </div>
        {error?.digest && (
          <p className="mt-4 text-[11px] text-slate-300">Ref: {error.digest}</p>
        )}
      </div>
    </div>
  )
}
