import { initializeApp, getApps } from "firebase/app"
import { getDatabase, Database } from "firebase/database"
import { getAuth, Auth } from "firebase/auth"

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH,
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
}

// Definite assignment: these are only accessed in browser ("use client" components)
let db!: Database
let auth!: Auth

if (typeof window !== "undefined") {
  const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0]
  db = getDatabase(app)
  auth = getAuth(app)
}

export { db, auth }
