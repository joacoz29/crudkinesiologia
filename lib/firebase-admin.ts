import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getDatabase } from 'firebase-admin/database'

let app

try {
  const apps = getApps()
  
  if (!apps.length) {
    app = initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
      databaseURL: process.env.FIREBASE_DATABASE_URL,
      databaseAuthVariableOverride: {
        uid: 'server'
      }
    })
  }
} catch (error) {
  console.error('Firebase admin initialization error:', error)
}

const db = getDatabase()

export { db } 