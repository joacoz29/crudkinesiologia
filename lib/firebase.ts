"use client"

import { initializeApp, getApps } from "firebase/app"
import { getDatabase } from "firebase/database"
import { getAuth } from "firebase/auth"

let app: any = null
let db: any = null
let auth: any = null

if (typeof window !== "undefined") {
  const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH,
    databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  }

  app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0]
  db = getDatabase(app)
  auth = getAuth(app)
}

export { db, auth }
export const libroDiarioDB = db

// Add this line to enable Firebase debugging in development
if (process.env.NODE_ENV !== "production") {
  console.log("Firebase config:", {
    ...firebaseConfig,
    apiKey: 'HIDDEN'  // No mostrar la API key en logs
  })
}

