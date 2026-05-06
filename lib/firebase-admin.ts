import { initializeApp, getApps, cert, ServiceAccount } from 'firebase-admin/app'
import { getDatabase, Database } from 'firebase-admin/database'

let db: Database | null = null
let initError: string | null = null

const projectId = process.env.FIREBASE_PROJECT_ID
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
const privateKey = process.env.FIREBASE_PRIVATE_KEY
const databaseURL = process.env.FIREBASE_DATABASE_URL

console.log('[firebase-admin] env check:', {
  FIREBASE_PROJECT_ID: projectId ? `set (${projectId})` : 'MISSING',
  FIREBASE_CLIENT_EMAIL: clientEmail ? `set (${clientEmail})` : 'MISSING',
  FIREBASE_PRIVATE_KEY: privateKey
    ? `set (length=${privateKey.length}, starts=${privateKey.slice(0, 27)})`
    : 'MISSING',
  FIREBASE_DATABASE_URL: databaseURL ? `set (${databaseURL})` : 'MISSING',
})

if (projectId) {
  try {
    const apps = getApps()

    if (!apps.length) {
      const serviceAccount: ServiceAccount = {
        projectId,
        clientEmail,
        privateKey: privateKey?.replace(/\\n/g, '\n'),
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
