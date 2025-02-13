import { NextResponse } from 'next/server'
import { db } from '@/lib/firebase-admin'

interface Patient {
  nombre: string
  apellido: string
  edad: string
  dni: string
  obraSocial: string
  nroAFL: string
  telefono: string
  diagnostico: string
  doctor: string
  sexo?: string
  domicilio?: string
  anotaciones?: string
  tto?: string
  sesiones?: string[]
  sesionesAux?: string[]
}

// Ajustar a 60 segundos máximo para plan Hobby de Vercel
export const maxDuration = 60
export const dynamic = 'force-dynamic' // Asegurarse que la ruta sea dinámica

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const searchTerm = searchParams.get('search') || ''
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '10')

    const patientsRef = db.ref('pacientes')
    
    // Simplificar la obtención de datos
    const snapshot = await patientsRef.once('value')
    
    if (!snapshot.exists()) {
      return NextResponse.json({
        patients: [],
        pagination: {
          currentPage: page,
          totalPages: 0,
          totalItems: 0,
        }
      })
    }

    let patients = Object.entries(snapshot.val()).map(([id, data]) => ({
      id,
      ...(data as unknown as Patient),
    }))

    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase()
      patients = patients.filter(patient => 
        patient.nombre.toLowerCase().includes(searchLower) ||
        patient.apellido.toLowerCase().includes(searchLower) ||
        patient.dni.toLowerCase().includes(searchLower)
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
    console.error('Error fetching patients:', error)
    return NextResponse.json(
      { error: 'Error al obtener pacientes' },
      { status: 500 }
    )
  }
} 