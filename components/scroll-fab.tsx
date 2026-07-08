"use client"

import { useEffect, useState } from "react"
import { ChevronsDown, ChevronsUp } from "lucide-react"

// FAB de scroll (abajo-izquierda), compartido por Libro Diario y Calendario:
// mientras quede página por recorrer apunta al fondo, y al llegar abajo se da
// vuelta para volver arriba de un salto. Se oculta si la página no da para
// scrollear. Observa también los cambios de alto del contenido (filas que se
// agregan, agenda que carga) para reevaluar sin esperar un evento de scroll.
export function ScrollFab({
  labelDown = "Ir al final",
  labelUp = "Volver arriba",
}: {
  labelDown?: string
  labelUp?: string
}) {
  const [dir, setDir] = useState<"down" | "up" | null>(null)

  useEffect(() => {
    const onScroll = () => {
      const doc = document.documentElement
      const scrollable = doc.scrollHeight - window.innerHeight > 240
      if (!scrollable) {
        setDir(null)
        return
      }
      const atBottom = window.scrollY + window.innerHeight >= doc.scrollHeight - 80
      setDir(atBottom ? "up" : "down")
    }
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("resize", onScroll)
    const ro = new ResizeObserver(onScroll)
    ro.observe(document.body)
    return () => {
      window.removeEventListener("scroll", onScroll)
      window.removeEventListener("resize", onScroll)
      ro.disconnect()
    }
  }, [])

  if (!dir) return null
  const abajo = dir === "down"
  const label = abajo ? labelDown : labelUp

  const handleClick = () => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    window.scrollTo({
      top: abajo ? document.documentElement.scrollHeight : 0,
      behavior: reduceMotion ? "auto" : "smooth",
    })
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      title={label}
      aria-label={label}
      className="fixed bottom-5 left-5 sm:bottom-6 sm:left-6 z-40 flex h-11 w-11 items-center justify-center rounded-full bg-[#001633] text-white shadow-lg transition-[transform,background-color] duration-150 ease-[var(--ease-out)] hover:bg-[#002966] active:scale-95 print:hidden"
    >
      {abajo ? <ChevronsDown className="h-5 w-5" /> : <ChevronsUp className="h-5 w-5" />}
    </button>
  )
}
