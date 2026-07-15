"use client"

// Página de prueba LOCAL para ver AgendaDia sin login y con datos de mentira
// (verificación de layout mobile). Gateada: en el build de producción/preview
// devuelve 404. No se linkea desde ningún lado.
import { notFound } from "next/navigation"
import { AgendaDia } from "@/components/agenda-dia"
import { Turno } from "@/types"

const T = (
  id: string,
  hora: string,
  nombre: string,
  apellido: string,
  estado: Turno["estado"],
  notas?: string,
): Turno => ({ id, hora, nombre, apellido, estado, ...(notas && { notas }), patientId: `p-${id}` })

const TURNOS: Turno[] = [
  T("1", "09:00", "Monica", "Veron", "asistio"),
  T("2", "09:20", "Michael", "Soto", "asistio"),
  T("3", "09:25", "Sebastian", "Monzon", "pendiente"),
  T("4", "09:30", "Hector", "Rotela", "asistio"),
  T("5", "09:30", "Angel", "Medina", "pendiente"),
  T("6", "09:45", "Maria Isabel", "Presa", "pendiente", "control post quirúrgico de rodilla"),
  T("7", "09:50", "Veronica", "Tula", "pendiente"),
  T("8", "10:10", "Gabriela Noemi", "Avellaneda", "pendiente"),
  T("9", "10:30", "Jose Daniel", "De Mendiburu", "cancelado"),
  T("10", "11:05", "Adriana Juana", "Pantaleone", "asistio", "sindrome vestibular y dorsalgia (solo ana)"),
  T("11", "11:10", "Maria Esther", "Da Silva", "ausente"),
]

export default function DevAgendaPage() {
  if (process.env.NODE_ENV === "production") notFound()
  return (
    <main className="max-w-7xl mx-auto py-4 px-4 bg-slate-50 min-h-screen">
      <AgendaDia
        fecha={new Date()}
        turnos={TURNOS}
        onNuevoTurno={() => {}}
        onEditarTurno={() => {}}
        onPrevDay={() => {}}
        onNextDay={() => {}}
        onConfirmarAsistencia={async () => {}}
      />
    </main>
  )
}
