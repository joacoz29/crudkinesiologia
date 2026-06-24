"use client"

import { useEffect, useState } from "react"
import { ref, onValue } from "firebase/database"
import { db } from "@/lib/firebase"
import { WifiOff } from "lucide-react"

// Avisa cuando se cae la conexión con Firebase. RTDB encola las escrituras offline
// y las reproduce al reconectar, pero sin esto el usuario no se entera: un guardado
// queda "colgado" (la promesa no resuelve) y no sabe si guardó. `.info/connected`
// es estado local del SDK (no requiere reglas/auth), siempre legible.
export function ConnectionStatus() {
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    const connectedRef = ref(db, ".info/connected")
    let timer: ReturnType<typeof setTimeout> | null = null

    const unsub = onValue(connectedRef, (snap) => {
      const connected = snap.val() === true
      if (connected) {
        if (timer) {
          clearTimeout(timer)
          timer = null
        }
        setOffline(false)
      } else if (!timer) {
        // Esperar antes de avisar: evita el cartel en el handshake inicial y en
        // microcortes de red que se recuperan solos.
        timer = setTimeout(() => setOffline(true), 2500)
      }
    })

    return () => {
      if (timer) clearTimeout(timer)
      unsub()
    }
  }, [])

  if (!offline) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-full bg-amber-500 px-4 py-2 text-sm font-medium text-white shadow-lg"
    >
      <WifiOff className="h-4 w-4" />
      Sin conexión — los cambios se guardarán al reconectar
    </div>
  )
}
