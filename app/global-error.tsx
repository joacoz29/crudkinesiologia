"use client"

import { useEffect } from "react"

// Backstop: solo se dispara si el error ocurre en el root layout (app/layout.tsx).
// Reemplaza TODO el documento, así que tiene que renderizar su propio <html>/<body>
// y no puede confiar en globals.css (de ahí los estilos inline). Caso raro, pero
// evita el pantallazo en blanco total.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("Error crítico (root layout):", error)
  }, [error])

  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f8fafc",
          fontFamily: "system-ui, sans-serif",
          padding: "1rem",
        }}
      >
        <div
          style={{
            maxWidth: 420,
            width: "100%",
            background: "#fff",
            border: "1px solid #e2e8f0",
            borderRadius: 16,
            padding: "2rem",
            textAlign: "center",
          }}
        >
          <h1 style={{ fontSize: 18, fontWeight: 600, color: "#001633", margin: 0 }}>
            Algo salió mal
          </h1>
          <p style={{ marginTop: 8, fontSize: 14, color: "#64748b" }}>
            Ocurrió un error inesperado. Probá recargar la página.
          </p>
          <button
            onClick={() => reset()}
            style={{
              marginTop: 24,
              background: "#001633",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "10px 20px",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Reintentar
          </button>
        </div>
      </body>
    </html>
  )
}
