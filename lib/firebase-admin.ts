import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getDatabase } from 'firebase-admin/database'

function getFirebaseAdmin() {
  const apps = getApps()
  
  if (!apps.length) {
    try {
      console.log('Starting Firebase Admin initialization...')
      console.log('Checking environment variables:')
      console.log('Project ID exists:', !!process.env.FIREBASE_PROJECT_ID)
      console.log('Client Email exists:', !!process.env.FIREBASE_CLIENT_EMAIL)
      console.log('Private Key exists:', !!process.env.FIREBASE_PRIVATE_KEY)
      console.log('Database URL exists:', !!process.env.FIREBASE_DATABASE_URL)

      return initializeApp({
        credential: cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY,
        }),
        databaseURL: process.env.FIREBASE_DATABASE_URL,
      })
    } catch (error) {
      console.error('Firebase admin initialization error:', error)
      console.error('Project ID:', process.env.FIREBASE_PROJECT_ID)
      console.error('Client Email:', process.env.FIREBASE_CLIENT_EMAIL)
      console.error('Database URL:', process.env.FIREBASE_DATABASE_URL)
      throw error
    }
  }
  return apps[0]
}

const db = getDatabase(getFirebaseAdmin())

export { db } 