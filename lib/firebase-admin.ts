import { createPrivateKey } from 'crypto'
import { initializeApp, getApps, cert, ServiceAccount } from 'firebase-admin/app'
import { getDatabase, Database } from 'firebase-admin/database'

let db: Database | null = null
let initError: string | null = null

// Diagnóstico solo bajo demanda: por defecto NO se loguea la config
// (projectId/clientEmail/databaseURL) para no volcar metadata sensible a los
// logs de Vercel en cada cold start. Activar con FIREBASE_ADMIN_DEBUG=1.
const DEBUG = process.env.FIREBASE_ADMIN_DEBUG === '1'

const projectId = process.env.FIREBASE_PROJECT_ID
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
const rawKey = process.env.FIREBASE_PRIVATE_KEY ?? ''
const databaseURL = process.env.FIREBASE_DATABASE_URL

// Sanitize: strip surrounding quotes, convert escaped \n, strip \r
let privateKey = rawKey.trim()
if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
  privateKey = privateKey.slice(1, -1)
}
privateKey = privateKey.replace(/\\n/g, '\n').replace(/\r/g, '')

// Normalize via Node.js crypto — re-exports in canonical PEM format, fixing
// any subtle formatting issues (wrong line lengths, extra whitespace, etc.)
try {
  const keyObj = createPrivateKey(privateKey)
  privateKey = keyObj.export({ type: 'pkcs8', format: 'pem' }) as string
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e)
  console.error('[firebase-admin] key normalization failed — key may be corrupted:', msg)
  // Continue with original key; cert() will likely fail with same error
}

if (DEBUG) {
  console.log('[firebase-admin] env check:', {
    projectId: projectId ?? 'MISSING',
    clientEmail: clientEmail ?? 'MISSING',
    databaseURL: databaseURL ?? 'MISSING',
    keyLength: privateKey.length,
    startsCorrectly: privateKey.startsWith('-----BEGIN PRIVATE KEY-----'),
    hasNewlines: privateKey.includes('\n'),
  })
}

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
    } else {
      db = getDatabase(apps[0])
    }
  } catch (error) {
    initError = error instanceof Error ? error.message : String(error)
    console.error('[firebase-admin] initialization failed:', initError)
  }
} else {
  console.error('[firebase-admin] FIREBASE_PROJECT_ID not set — skipping initialization')
}

export { db, initError }
