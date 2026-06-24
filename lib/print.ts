// Imprime SOLO la región marcada con [data-print-portal] (ver components/printable.tsx
// + reglas @media print en globals.css): pone un flag en <body>, abre el diálogo de
// impresión y lo limpia al volver. Sin el flag, un Ctrl+P normal imprime la página
// entera (comportamiento sano por defecto: no rompe la impresión nativa).
export function printScoped() {
  if (typeof window === "undefined") return
  document.body.setAttribute("data-printing", "")
  const cleanup = () => {
    document.body.removeAttribute("data-printing")
    window.removeEventListener("afterprint", cleanup)
  }
  window.addEventListener("afterprint", cleanup)
  window.print()
}
