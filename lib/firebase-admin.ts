import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getDatabase } from 'firebase-admin/database'

const firebaseAdminConfig = {
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  }),
  databaseURL: process.env.FIREBASE_DATABASE_URL
}

const apps = getApps()

if (!apps.length) {
  initializeApp(firebaseAdminConfig)
}

export const db = getDatabase() 