import { ref, set, get } from "firebase/database"
import { db } from "@/lib/firebase"

interface LibroDiarioEntry {
  nombreApellido: string
  cobertura: "Particular" | "Obra Social"
  obraSocial: string
  debe: number
  haber: number
}

export async function addToLibroDiario(entry: {
  nombreApellido: string
  obraSocial: string
}) {
  const today = new Date().toISOString().split('T')[0]
  const libroDiarioRef = ref(db, `libroDiario/${today}`)
  
  // Obtener entradas existentes
  const snapshot = await get(libroDiarioRef)
  const existingData = snapshot.exists() ? snapshot.val() : { entradas: [] }
  
  // Crear nueva entrada
  const newEntry: LibroDiarioEntry = {
    nombreApellido: entry.nombreApellido,
    cobertura: entry.obraSocial === "-" ? "Particular" : "Obra Social",
    obraSocial: entry.obraSocial,
    debe: 0,
    haber: 0,
  }
  
  // Agregar nueva entrada al array existente
  const updatedEntradas = [...(existingData.entradas || []), newEntry]
  
  // Calcular nuevo total
  const totalHaber = updatedEntradas.reduce((sum, entrada) => sum + (entrada.haber || 0), 0)
  
  // Guardar datos actualizados
  await set(libroDiarioRef, {
    fecha: new Date().toISOString(),
    entradas: updatedEntradas,
    totalHaber,
  })
} 