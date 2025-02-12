import { NextResponse } from 'next/server'
import { db } from '@/lib/firebase-admin'
import { getDatabase } from 'firebase-admin/database'

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

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const searchTerm = searchParams.get('search') || ''
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '10')

    const patientsRef = db.ref('pacientes')
    const snapshot = await patientsRef.get()
    
    let patients: Patient[] = []
    
    if (snapshot.exists()) {
      patients = Object.entries(snapshot.val()).map(([id, data]) => ({
        id,
        ...(data as unknown as Patient),
      }))

      // Aplicar filtro de búsqueda
      if (searchTerm) {
        const searchLower = searchTerm.toLowerCase()
        patients = patients.filter(patient => 
          patient.nombre.toLowerCase().includes(searchLower) ||
          patient.apellido.toLowerCase().includes(searchLower) ||
          patient.dni.toLowerCase().includes(searchLower)
        )
      }

      // Ordenar por nombre
      patients.sort((a, b) => a.nombre.localeCompare(b.nombre))
    }

    // Calcular paginación
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
      { error: 'Error interno del servidor' },
      { status: 500 }
    )
  }
} 