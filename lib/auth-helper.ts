import { User } from 'firebase/auth'

export const ADMIN_EMAIL = 'joaco@joaco.com.ar'

const ADMIN_EMAILS = new Set([
  ADMIN_EMAIL,
  'anatullio@kinesiologia.com.ar',
  'alanmartineztullio@kinesiologia.com.ar',
])

const userNameMap: Record<string, string> = {
  'kinesiologiaintegral@gmail.com': 'Ana la Jefa',
  'karina@kinesiologia.com.ar': 'Karina',
  'sofia@kinesiologia.com.ar': 'Sofia',
  'eugenia@kinesiologia.com': 'Eugenia',
  'joaco@gmail.com': 'Joaco',
  [ADMIN_EMAIL]: 'Joaco',
  'eugeniafunk@kinesiologia.com': 'Eugenia Funk',
  'sofiamuslo@kinesiologia.com.ar': 'Sofia Muslo',
  'karinadiaz@kinesiologia.com.ar': 'Karina Díaz',
  'camilabaldi@kinesiologia.com.ar': 'Camila Baldi',
  'gonzalogonzalez@kinesiologia.com.ar': 'Gonzalo González',
  'anatullio@kinesiologia.com.ar': 'Ana Tullio',
  'alanmartineztullio@kinesiologia.com.ar': 'Alan Martinez Tullio',
}

export function getUserDisplayName(user: User | null): string {
  if (!user) return 'Usuario'
  if (user.email && user.email in userNameMap) {
    return userNameMap[user.email]
  }
  return user.displayName || user.email || 'Usuario'
}

export function isAdmin(user: User | null): boolean {
  return !!user?.email && ADMIN_EMAILS.has(user.email)
}
