import { NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { db } from '@/lib/firebase-admin'
import { format } from 'date-fns-tz'

// Endpoint PÚBLICO (los pacientes no tienen cuenta): toda la validación es server-side
// y el cliente nunca toca la base. Anti-abuso: rate-limit por IP + 1 opinión por DNI cada 7 días.

export const maxDuration = 5
export const dynamic = 'force-dynamic'

const TZ = 'America/Argentina/Buenos_Aires'
const DIAS_ENTRE_OPINIONES = 7
const MAX_REQUESTS_POR_HORA_POR_IP = 10

export async function POST(request: Request) {
  try {
    if (!db) {
      return NextResponse.json({ error: 'Servicio no disponible, probá más tarde.' }, { status: 500 })
    }

    // Rate limit por IP (hasheada — no guardamos IPs crudas)
    const ip = (request.headers.get('x-forwarded-for') ?? 'desconocida').split(',')[0].trim()
    const ipHash = createHash('sha256').update(ip).digest('hex').slice(0, 16)
    const throttleRef = db.ref(`opinionThrottle/${ipHash}`)
    const ahora = Date.now()
    const throttle = (await throttleRef.once('value')).val() as { windowStart: number; count: number } | null
    if (throttle && ahora - throttle.windowStart < 3_600_000) {
      if (throttle.count >= MAX_REQUESTS_POR_HORA_POR_IP) {
        return NextResponse.json({ error: 'Demasiados intentos. Probá más tarde.' }, { status: 429 })
      }
      await throttleRef.update({ count: throttle.count + 1 })
    } else {
      await throttleRef.set({ windowStart: ahora, count: 1 })
    }

    const body = await request.json().catch(() => null)
    if (!body) {
      return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 })
    }
    const dni = String(body.dni ?? '').replace(/\D/g, '')
    const rating = Number(body.rating)
    const comentario = String(body.comentario ?? '').trim().slice(0, 500)
    const atendidoPor = String(body.atendidoPor ?? '').trim().slice(0, 60)

    if (dni.length < 6 || dni.length > 9 || !Number.isInteger(rating) || rating < 1 || rating > 5) {
      return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 })
    }

    // Buscar paciente por DNI (normalizado a solo dígitos en ambos lados)
    const snap = await db.ref('pacientes').once('value')
    let patientId: string | null = null
    let nombre = ''
    snap.forEach((child) => {
      const p = child.val() as { dni?: string; nombre?: string; apellido?: string }
      if (String(p?.dni ?? '').replace(/\D/g, '') === dni) {
        patientId = child.key
        nombre = `${p?.nombre ?? ''} ${p?.apellido ?? ''}`.trim()
        return true // corta la iteración
      }
      return false
    })

    if (!patientId) {
      return NextResponse.json(
        { error: 'No encontramos tu DNI en nuestros registros. Consultá en recepción.' },
        { status: 404 }
      )
    }

    // Una opinión por paciente cada N días
    const ultima = (await db.ref(`opinionesIndice/${patientId}`).once('value')).val() as string | null
    if (ultima && ahora - new Date(ultima).getTime() < DIAS_ENTRE_OPINIONES * 86_400_000) {
      return NextResponse.json(
        { error: 'Ya registraste una opinión hace poco. ¡Gracias por tu tiempo!' },
        { status: 429 }
      )
    }

    const mes = format(new Date(), 'yyyy-MM', { timeZone: TZ })
    const opinionId = db.ref(`opiniones/${mes}`).push().key
    const fecha = new Date().toISOString()

    await db.ref().update({
      [`opiniones/${mes}/${opinionId}`]: {
        patientId,
        nombre,
        rating,
        ...(comentario && { comentario }),
        ...(atendidoPor && { atendidoPor }),
        fecha,
      },
      [`opinionesIndice/${patientId}`]: fecha,
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Error in POST /api/opinion:', error)
    return NextResponse.json({ error: 'Error inesperado. Probá más tarde.' }, { status: 500 })
  }
}
