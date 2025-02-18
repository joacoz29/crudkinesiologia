import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getDatabase } from 'firebase-admin/database'

function getFirebaseAdmin() {
  const apps = getApps()
  
  if (!apps.length) {
    try {
      // Obtener la clave privada y procesarla
      let privateKey = process.env.FIREBASE_PRIVATE_KEY || ''
      
      // Si la clave viene con comillas, las removemos
      if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
        privateKey = privateKey.slice(1, -1)
      }
      
      // Reemplazar los \n literales por saltos de línea reales
      privateKey = privateKey.replace(/\\n/g, '\n')
      
      console.log('Starting Firebase Admin initialization...')
      console.log('Private key format check:')
      console.log('Starts with correct header:', privateKey.startsWith('-----BEGIN PRIVATE KEY-----'))
      console.log('Ends with correct footer:', privateKey.endsWith('-----END PRIVATE KEY-----\n'))
      
      return initializeApp({
        credential: cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL?.replace(/"/g, ''),
          privateKey: privateKey,
        }),
        databaseURL: process.env.FIREBASE_DATABASE_URL,
      })
    } catch (error) {
      console.error('Firebase admin initialization error:', error)
      throw error
    }
  }
  return apps[0]
}

const db = getDatabase(getFirebaseAdmin())

export { db } 