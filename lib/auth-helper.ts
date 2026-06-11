import { User } from 'firebase/auth'
import { auth } from '@/lib/firebase'

export const ADMIN_EMAIL = 'joaco@joaco.com.ar'

export type UserRole = 'admin' | 'kinesiologo' | 'asistente'

// Roles por cuenta. Admin ve todo; asistentes ven libro diario; kinesiólogos no.
// Cuentas no mapeadas: sin rol → acceso mínimo (pacientes y calendario).
const ROLE_MAP: Record<string, UserRole> = {
  // Admins (Ana es la dueña; Joaco y Alan administran)
  [ADMIN_EMAIL]: 'admin',
  'joaco@gmail.com': 'admin',
  'anatullio@kinesiologia.com.ar': 'admin',
  'kinesiologiaintegral@gmail.com': 'admin',
  'alanmartineztullio@kinesiologia.com.ar': 'admin',
  // Kinesiólogos
  'gonzalogonzalez@kinesiologia.com.ar': 'kinesiologo',
  'camilabaldi@kinesiologia.com.ar': 'kinesiologo',
  // Asistentes
  'karina@kinesiologia.com.ar': 'asistente',
  'karinadiaz@kinesiologia.com.ar': 'asistente',
  'sofia@kinesiologia.com.ar': 'asistente',
  'sofianussli@kinesiologia.com.ar': 'asistente',
  'eugenia@kinesiologia.com': 'asistente',
  'eugeniafunk@kinesiologia.com': 'asistente',
}

export function getUserRole(user: User | null): UserRole | null {
  if (!user?.email) return null
  return ROLE_MAP[user.email] ?? null
}

// Libro diario: solo administración (admins) y asistentes — los kinesiólogos no manejan la caja
export function canAccessLibroDiario(user: User | null): boolean {
  const rol = getUserRole(user)
  return rol === 'admin' || rol === 'asistente'
}

const userNameMap: Record<string, string> = {
  'kinesiologiaintegral@gmail.com': 'Ana la Jefa',
  'karina@kinesiologia.com.ar': 'Karina',
  'sofia@kinesiologia.com.ar': 'Sofia',
  'eugenia@kinesiologia.com': 'Eugenia',
  'joaco@gmail.com': 'Joaco',
  [ADMIN_EMAIL]: 'Joaco',
  'eugeniafunk@kinesiologia.com': 'Eugenia Funk',
  'karinadiaz@kinesiologia.com.ar': 'Karina Díaz',
  'camilabaldi@kinesiologia.com.ar': 'Camila Baldi',
  'gonzalogonzalez@kinesiologia.com.ar': 'Gonzalo González',
  'anatullio@kinesiologia.com.ar': 'Ana Tullio',
  'alanmartineztullio@kinesiologia.com.ar': 'Alan Martinez Tullio',
  'sofianussli@kinesiologia.com.ar': 'Sofia Nussli',
}

export function getUserDisplayName(user: User | null): string {
  if (!user) return 'Usuario'
  if (user.email && user.email in userNameMap) {
    return userNameMap[user.email]
  }
  return user.displayName || user.email || 'Usuario'
}

export function isAdmin(user: User | null): boolean {
  return getUserRole(user) === 'admin'
}

// Header de autorización para las API routes (verificado server-side con verifyIdToken)
export async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = await auth.currentUser?.getIdToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}
