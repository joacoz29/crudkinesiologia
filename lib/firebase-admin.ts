import { initializeApp, getApps, cert, ServiceAccount } from 'firebase-admin/app'
import { getDatabase, Database } from 'firebase-admin/database'

let db: Database | null = null
let initError: string | null = null

const projectId = process.env.FIREBASE_PROJECT_ID
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
const rawKey = process.env.FIREBASE_PRIVATE_KEY ?? ''
const databaseURL = process.env.FIREBASE_DATABASE_URL

// Sanitize key: strip surrounding quotes (common copy-paste artifact),
// then convert literal \n sequences to actual newlines
let privateKey = rawKey.trim()
if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
  privateKey = privateKey.slice(1, -1)
}
privateKey = privateKey.replace(/\\n/g, '\n')

console.log('[firebase-admin] env check:', {
  projectId: projectId ?? 'MISSING',
  clientEmail: clientEmail ?? 'MISSING',
  databaseURL: databaseURL ?? 'MISSING',
  keyLength: privateKey.length,
  keyStart: privateKey.slice(0, 27),
  keyEnd: privateKey.slice(-25).replace(/\n/g, '\\n'),
  hasNewlines: privateKey.includes('\n'),
  startsCorrectly: privateKey.startsWith('-----BEGIN PRIVATE KEY-----'),
})

if (projectId) {
  try {
    const apps = getApps()

    if (!apps.length) {
      const serviceAccount: ServiceAccount = {
        projectId,
        clientEmail,
        privateKey,
      }

      const app = initializeApp({
        credential: cert(serviceAccount),
        databaseURL,
      })
      db = getDatabase(app)
      console.log('[firebase-admin] initialized successfully')
    } else {
      db = getDatabase(apps[0])
      console.log('[firebase-admin] reusing existing app')
    }
  } catch (error) {
    initError = error instanceof Error ? error.message : String(error)
    console.error('[firebase-admin] initialization failed:', initError)
  }
} else {
  console.error('[firebase-admin] FIREBASE_PROJECT_ID not set — skipping initialization')
}

export { db, initError }
