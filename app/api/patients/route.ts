import { NextResponse } from 'next/server'
import { db } from '@/lib/firebase-admin'
import { Patient } from "@/types"

// Ajustar a 5 segundos máximo para plan Hobby de Vercel
export const maxDuration = 5
export const dynamic = 'force-dynamic' // Asegurarse que la ruta sea dinámica

export async function GET(request: Request) {
  try {
    if (!db) {
      return NextResponse.json({ error: 'Database not initialized' }, { status: 500 })
    }

    const { searchParams } = new URL(request.url)
    const searchTerm = searchParams.get('search') || ''
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '10')

    const patientsRef = db.ref('pacientes')
    const snapshot = await patientsRef.once('value')

    if (!snapshot.exists()) {
      return NextResponse.json({
        patients: [],
        pagination: { currentPage: page, totalPages: 0, totalItems: 0 }
      })
    }

    const data = snapshot.val() as Record<string, Record<string, unknown>>

    let patients = Object.entries(data).map(([id, record]) => {
      const raw = record as Record<string, unknown>
      const sesiones = Array.isArray(raw.sesiones)
        ? raw.sesiones as string[]
        : typeof raw.sesiones === "string"
          ? (raw.sesiones as string).split(", ").filter(Boolean)
          : []
      return { id, ...raw, sesiones }
    }) as unknown as Patient[]

    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase()
      patients = patients.filter(patient => 
        patient.nombre?.toLowerCase().includes(searchLower) ||
        patient.apellido?.toLowerCase().includes(searchLower) ||
        patient.dni?.toLowerCase().includes(searchLower)
      )
    }

    patients.sort((a, b) => a.nombre.localeCompare(b.nombre))

    const totalItems = patients.length
    const totalPages = Math.ceil(totalItems / limit)
    const startIndex = (page - 1) * limit
    const paginatedPatients = patients.slice(startIndex, startIndex + limit)

    return NextResponse.json({
      patients: paginatedPatients,
      pagination: {
        currentPage: page,
        totalPages,
        totalItems,
      }
    })
  } catch (error) {
    console.error('Error in GET /api/patients:', error)
    return NextResponse.json(
      { error: 'Error al obtener pacientes' },
      { status: 500 }
    )
  }
} 