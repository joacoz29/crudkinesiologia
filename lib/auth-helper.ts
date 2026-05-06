import { User } from 'firebase/auth'

const userNameMap: Record<string, string> = {
  'kinesiologiaintegral@gmail.com': 'Ana la Jefa',
  'eugenia@kinesiologia.com': 'Eugenia Funk Martinez',
  'joaco@gmail.com': 'Joaco',
}

export function getUserDisplayName(user: User | null): string {
  if (!user) return 'Usuario'
  
  if (user.email && user.email in userNameMap) {
    return userNameMap[user.email]
  }
  
  return user.displayName || user.email || 'Usuario'
}
