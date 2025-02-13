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

export const maxDuration = 300 // Aumentar el timeout a 300 segundos
export const dynamic = 'force-dynamic' // Asegurarse que la ruta sea dinámica

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const searchTerm = searchParams.get('search') || ''
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '10')

    // Agregar timeout a la promesa de Firebase
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Database timeout')), 10000)
    })

    const patientsRef = db.ref('pacientes')
    const dataPromise = patientsRef.get()
    
    // Race entre el timeout y la petición
    const snapshot = await Promise.race([dataPromise, timeoutPromise])
      .catch(error => {
        console.error('Database error:', error)
        throw new Error('Database connection timeout')
      })

    let patients = []
    
    if (snapshot && snapshot.exists()) {
      patients = Object.entries(snapshot.val()).map(([id, data]) => ({
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
    }

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
      { error: error.message || 'Error interno del servidor' },
      { status: error.message === 'Database connection timeout' ? 504 : 500 }
    )
  }
} 