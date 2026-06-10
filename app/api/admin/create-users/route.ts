import { NextResponse } from 'next/server'
import { adminAuth } from '@/lib/firebase-admin'

export const dynamic = 'force-dynamic'

const USERS_TO_CREATE = [
  { email: 'eugeniafunk@kinesiologia.com', password: 'eugeniafunkmartinez', displayName: 'Eugenia Funk' },
  { email: 'sofiamuslo@kinesiologia.com.ar', password: 'sofiamuslo', displayName: 'Sofia Muslo' },
  { email: 'karinadiaz@kinesiologia.com.ar', password: 'karinadiaz', displayName: 'Karina Díaz' },
  { email: 'camilabaldi@kinesiologia.com.ar', password: 'camilabaldi', displayName: 'Camila Baldi' },
  { email: 'gonzalogonzalez@kinesiologia.com.ar', password: 'gonzalogonzalez', displayName: 'Gonzalo González' },
  { email: 'anatullio@kinesiologia.com.ar', password: 'anapatriciatullio', displayName: 'Ana Tullio' },
  { email: 'alanmartineztullio@kinesiologia.com.ar', password: 'alangabrielmartineztullio', displayName: 'Alan Martinez Tullio' },
  { email: 'sofianussli@kinesiologia.com.ar', password: 'sofianussli', displayName: 'Sofia Nussli' },
]

export async function GET() {
  if (!adminAuth) {
    return NextResponse.json({ error: 'adminAuth not initialized' }, { status: 500 })
  }

  const results: { email: string; status: string; error?: string }[] = []

  for (const user of USERS_TO_CREATE) {
    try {
      await adminAuth.createUser({
        email: user.email,
        password: user.password,
        displayName: user.displayName,
      })
      results.push({ email: user.email, status: 'created' })
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code
      if (code === 'auth/email-already-exists') {
        results.push({ email: user.email, status: 'already-exists' })
      } else {
        const msg = err instanceof Error ? err.message : String(err)
        results.push({ email: user.email, status: 'error', error: msg })
      }
    }
  }

  return NextResponse.json({ results })
}
