import { initializeApp, getApps, cert, ServiceAccount } from 'firebase-admin/app'
import { getDatabase, Database } from 'firebase-admin/database'

let db: Database | null = null

if (process.env.FIREBASE_PROJECT_ID) {
  try {
    const apps = getApps()
    
    if (!apps.length) {
      const serviceAccount: ServiceAccount = {
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }
      
      const app = initializeApp({
        credential: cert(serviceAccount),
        databaseURL: process.env.FIREBASE_DATABASE_URL,
      })
      db = getDatabase(app)
    } else {
      db = getDatabase(apps[0])
    }
  } catch (error) {
    throw new Error(`Firebase admin initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

export { db }
