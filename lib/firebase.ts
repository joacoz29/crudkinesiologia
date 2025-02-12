import { initializeApp } from "firebase/app"
import { getDatabase } from "firebase/database"
import { getAuth } from "firebase/auth"

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH,
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
}

// Initialize Firebase
const app = initializeApp(firebaseConfig)

// Initialize Realtime Database and get a reference to the service
export const db = getDatabase(app)
export const libroDiarioDB = getDatabase(app, "https://librodiario-7d332.firebaseio.com")

export const auth = getAuth(app)

// Add this line to enable Firebase debugging
if (process.env.NODE_ENV !== "production") {
  console.log("Firebase config:", firebaseConfig)
}

