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

// Ajustar a 10 segundos máximo para plan Hobby de Vercel
export const maxDuration = 10
export const dynamic = 'force-dynamic' // Asegurarse que la ruta sea dinámica

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const searchTerm = searchParams.get('search') || ''
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '10')

    console.log('Database URL:', process.env.FIREBASE_DATABASE_URL)
    console.log('Attempting to fetch patients...')

    const patientsRef = db.ref('pacientes')
    const snapshot = await patientsRef.once('value', (snapshot) => {
      console.log('Data fetched successfully')
      return snapshot
    }, (error) => {
      console.error('Error fetching data:', error)
      throw error
    })

    if (!snapshot || !snapshot.exists()) {
      console.log('No data found')
      return NextResponse.json({
        patients: [],
        pagination: { currentPage: page, totalPages: 0, totalItems: 0 }
      })
    }

    const data = snapshot.val()
    console.log('Data received:', Object.keys(data).length, 'patients')

    let patients = Object.entries(data).map(([id, data]) => ({
      id,
      ...(data as any)
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
    console.error('Error in GET /api/patients:', error)
    return NextResponse.json(
      { error: 'Error al obtener pacientes', details: error.message },
      { status: 500 }
    )
  }
} 