import { NextResponse } from 'next/server'
import { db, adminAuth, initError } from '@/lib/firebase-admin'
import { Patient } from "@/types"

// Ajustar a 5 segundos máximo para plan Hobby de Vercel
export const maxDuration = 5
export const dynamic = 'force-dynamic' // Asegurarse que la ruta sea dinámica

export async function GET(request: Request) {
  try {
    if (!db) {
      const missing = ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY', 'FIREBASE_DATABASE_URL']
        .filter(key => !process.env[key])
      console.error('[/api/patients] db is null. Missing:', missing, 'initError:', initError)
      return NextResponse.json({
        error: 'Database not initialized',
        _build: '415a385-v2',
        missing: missing.length ? missing : [],
        initError: initError ?? 'no error captured — check env vars',
      }, { status: 500 })
    }

    // Solo usuarios autenticados: el endpoint expone datos médicos.
    // TODO antes de crear cuentas de pacientes (fase 1 QR): exigir además email del staff.
    if (!adminAuth) {
      return NextResponse.json({ error: 'Auth not initialized' }, { status: 500 })
    }
    const authHeader = request.headers.get('authorization') ?? ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }
    try {
      await adminAuth.verifyIdToken(token)
    } catch {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
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

    const data = (snapshot.val() || {}) as Record<string, Record<string, unknown>>

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
      { error: 'Error al obtener pacientes', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
} 