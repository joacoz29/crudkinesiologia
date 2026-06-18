"use client"

import { useState } from "react"
import { signInWithEmailAndPassword } from "firebase/auth"
import { auth } from "@/lib/firebase"
import { writeLog } from "@/lib/helpers"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export default function LoginPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await signInWithEmailAndPassword(auth, email, password)
      await writeLog({ accion: "login", detalle: "Inició sesión" })
      router.push("/")
    } catch (error) {
      console.error("Sign in error:", error)
      setError("Invalid email or password")
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
      <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-sm">
        <h1 className="text-2xl font-bold mb-6 text-center text-[#001633]">Iniciar Sesión</h1>
        {error && <p className="text-red-500 mb-4 text-center">{error}</p>}
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
              className="border-[#001633] focus:ring-[#001633] focus:border-[#001633]"
            />
          </div>
          <Button type="submit" className="w-full bg-[#001633] hover:bg-[#002966] transition-colors">
            Iniciar Sesión
          </Button>
        </form>
      </div>
    </div>
  )
}

