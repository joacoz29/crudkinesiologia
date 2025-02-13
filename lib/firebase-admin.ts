import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getDatabase } from 'firebase-admin/database'

function formatPrivateKey(key: string) {
  const formattedKey = key.replace(/\\n/g, '\n')
  return formattedKey.startsWith('-----BEGIN PRIVATE KEY-----') 
    ? formattedKey 
    : `-----BEGIN PRIVATE KEY-----\n${formattedKey}\n-----END PRIVATE KEY-----\n`
}

function getFirebaseAdmin() {
  if (getApps().length === 0) {
    const privateKey = formatPrivateKey(process.env.FIREBASE_PRIVATE_KEY || '')
    
    try {
      return initializeApp({
        credential: cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: privateKey,
        }),
        databaseURL: process.env.FIREBASE_DATABASE_URL,
      })
    } catch (error) {
      console.error('Firebase admin initialization error:', error)
      console.error('Project ID:', process.env.FIREBASE_PROJECT_ID)
      console.error('Client Email:', process.env.FIREBASE_CLIENT_EMAIL)
      console.error('Database URL:', process.env.FIREBASE_DATABASE_URL)
      // No imprimas la privateKey por seguridad
      throw error
    }
  }
  return getApps()[0]
}

let db: any = null

try {
  const firebaseApp = getFirebaseAdmin()
  db = getDatabase(firebaseApp)
} catch (error) {
  console.error('Error initializing database:', error)
}

export { db } 