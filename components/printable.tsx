"use client"

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"

// Portalea su contenido a <body> dentro de [data-print-portal]. En pantalla está
// oculto; al imprimir con printScoped() se muestra y se oculta el resto de la app
// (ver globals.css). Va portaleado a <body> para escapar del clipping de los modales
// (overflow/max-height/transform que Radix le pone al DialogContent).
export function Printable({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null
  return createPortal(<div data-print-portal>{children}</div>, document.body)
}
