"use client"

import { useState } from "react"
import { signInWithEmailAndPassword } from "firebase/auth"
import { auth } from "@/lib/firebase"
import { writeLog } from "@/lib/helpers"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2 } from "lucide-react"

export default function LoginPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    // Guard de doble submit: evita un segundo login (y su writeLog duplicado)
    // si se clickea dos veces mientras autentica.
    if (loading) return
    setLoading(true)
    setError("")
    try {
      await signInWithEmailAndPassword(auth, email, password)
      await writeLog({ accion: "login", detalle: "Inició sesión" })
      router.push("/")
      // No reseteo `loading`: navegamos a "/", dejar el botón bloqueado evita
      // un flash de re-habilitado durante la transición.
    } catch (error) {
      console.error("Sign in error:", error)
      setError("Email o contraseña incorrectos")
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
      <div className="bg-white p-8 rounded-2xl shadow-md w-full max-w-sm animate-in fade-in slide-in-from-bottom-2 duration-300 ease-out">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-[#001633]">Kinesiología Integral</h1>
          <p className="text-sm text-slate-400 mt-1">Lic. Ana Patricia Tullio</p>
        </div>
        {error && <p className="text-red-500 mb-4 text-center text-sm">{error}</p>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="email" className="text-[#001633]">
              Email
            </Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={loading}
              className="border-[#001633] focus:ring-[#001633] focus:border-[#001633]"
            />
          </div>
          <div>
            <Label htmlFor="password" className="text-[#001633]">
              Contraseña
            </Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading}
              className="border-[#001633] focus:ring-[#001633] focus:border-[#001633]"
            />
          </div>
          <Button type="submit" disabled={loading} className="w-full bg-[#001633] hover:bg-[#002966]">
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Ingresando...
              </>
            ) : (
              "Iniciar Sesión"
            )}
          </Button>
        </form>
      </div>
    </div>
  )
}
