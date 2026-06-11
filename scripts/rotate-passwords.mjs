// Rotación de contraseñas de los usuarios cuyas claves quedaron expuestas en el
// historial de git (ex /api/admin/create-users). Genera contraseñas aleatorias
// fuertes, las actualiza vía Firebase Admin y las imprime UNA vez por consola.
//
// Uso:
//   1. Credenciales admin en .env.local (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL,
//      FIREBASE_PRIVATE_KEY) — las mismas que usa Vercel.
//   2. node scripts/rotate-passwords.mjs
//
// Nota: al rotar, Firebase revoca las sesiones activas — cada usuaria deberá
// volver a iniciar sesión con su contraseña nueva.

import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { randomBytes } from "node:crypto"

// Archivo local con las claves nuevas (gitignoreado — borrarlo después de repartirlas)
const ARCHIVO_SALIDA = "claves-nuevas.txt"
import { initializeApp, cert } from "firebase-admin/app"
import { getAuth } from "firebase-admin/auth"

const EMAILS_A_ROTAR = [
  "eugeniafunk@kinesiologia.com",
  "sofiamuslo@kinesiologia.com.ar",
  "karinadiaz@kinesiologia.com.ar",
  "camilabaldi@kinesiologia.com.ar",
  "gonzalogonzalez@kinesiologia.com.ar",
  "anatullio@kinesiologia.com.ar",
  "alanmartineztullio@kinesiologia.com.ar",
  "sofianussli@kinesiologia.com.ar",
]

// Cargar .env.local si existe (parser mínimo: KEY=VALUE, ignora comentarios)
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
  }
}

const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL } = process.env
let privateKey = (process.env.FIREBASE_PRIVATE_KEY ?? "").replace(/\\n/g, "\n").replace(/\r/g, "")
if (privateKey.startsWith('"') && privateKey.endsWith('"')) privateKey = privateKey.slice(1, -1)

if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !privateKey) {
  console.error("Faltan credenciales: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL y/o FIREBASE_PRIVATE_KEY")
  console.error("Ponelas en .env.local (mismos valores que en Vercel) y volvé a correr el script.")
  process.exit(1)
}

initializeApp({
  credential: cert({ projectId: FIREBASE_PROJECT_ID, clientEmail: FIREBASE_CLIENT_EMAIL, privateKey }),
})
const auth = getAuth()

// Legible para dictar por teléfono: minúsculas + dígitos, sin ambiguos (0/o, 1/l), 12 chars
function generarPassword() {
  const chars = "abcdefghijkmnpqrstuvwxyz23456789"
  return Array.from(randomBytes(12), (b) => chars[b % chars.length]).join("")
}

console.log("Rotando contraseñas...\n")
let errores = 0
const lineas = [
  "CONTRASEÑAS NUEVAS — Kinesiología Integral",
  `Rotadas el ${new Date().toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}`,
  "BORRAR ESTE ARCHIVO después de repartirlas.",
  "",
]

for (const email of EMAILS_A_ROTAR) {
  try {
    const user = await auth.getUserByEmail(email)
    const password = generarPassword()
    await auth.updateUser(user.uid, { password })
    console.log(`  ${email.padEnd(45)} → ${password}`)
    lineas.push(`${email.padEnd(45)} ${password}`)
  } catch (err) {
    errores++
    const code = err?.code ?? ""
    if (code === "auth/user-not-found") {
      console.log(`  ${email.padEnd(45)} → (no existe en Firebase Auth, salteado)`)
    } else {
      console.error(`  ${email.padEnd(45)} → ERROR: ${err?.message ?? err}`)
    }
  }
}

writeFileSync(ARCHIVO_SALIDA, lineas.join("\r\n") + "\r\n", "utf8")
console.log(`\nListo${errores ? ` (${errores} con error/salteados)` : ""}. Claves guardadas en ${ARCHIVO_SALIDA} — repartilas y borrá el archivo.`)
