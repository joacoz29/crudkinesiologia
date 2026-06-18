// Diagnóstico de DNIs de pacientes — SOLO LECTURA (no escribe nada).
//
// Agrupa los pacientes por DNI normalizado y reporta la composición del problema
// de "DNIs duplicados": vacíos, inválidos/relleno, duplicados reales, distribución
// por longitud y el top de valores más repetidos (para detectar valores de relleno).
//
// Uso:
//   1. Credenciales en .env.local (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL,
//      FIREBASE_PRIVATE_KEY, FIREBASE_DATABASE_URL) — las mismas que usa Vercel.
//   2. node scripts/dni-audit.mjs

import { readFileSync, existsSync } from "node:fs"
import { initializeApp, cert } from "firebase-admin/app"
import { getDatabase } from "firebase-admin/database"

// Cargar .env.local (parser mínimo KEY=VALUE, ignora comentarios)
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
  }
}

const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_DATABASE_URL } = process.env
let privateKey = (process.env.FIREBASE_PRIVATE_KEY ?? "").replace(/\\n/g, "\n").replace(/\r/g, "")
if (privateKey.startsWith('"') && privateKey.endsWith('"')) privateKey = privateKey.slice(1, -1)

if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !privateKey || !FIREBASE_DATABASE_URL) {
  console.error("Faltan credenciales en .env.local (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY, FIREBASE_DATABASE_URL).")
  process.exit(1)
}

initializeApp({
  credential: cert({ projectId: FIREBASE_PROJECT_ID, clientEmail: FIREBASE_CLIENT_EMAIL, privateKey }),
  databaseURL: FIREBASE_DATABASE_URL,
})

// Mismas reglas que lib/tareas.ts (mantener en sync)
const DNI_RELLENO = new Set(["12345678", "1234567", "87654321", "123456789"])
const digitsOf = (v) => String(v ?? "").replace(/\D/g, "")
const dniValido = (d) => d.length >= 6 && d.length <= 9 && !/^(\d)\1+$/.test(d) && !DNI_RELLENO.has(d)
const nombreDe = (p) => `${p?.nombre ?? ""} ${p?.apellido ?? ""}`.trim() || "(sin nombre)"

console.log("Leyendo pacientes…")
const snap = await getDatabase().ref("pacientes").once("value")
const raw = snap.val() ?? {}
const pacientes = Object.entries(raw).map(([id, p]) => ({ id, ...p }))
const total = pacientes.length

let vacios = 0
const lenDist = new Map()
const byDni = new Map()
for (const p of pacientes) {
  const d = digitsOf(p.dni)
  if (d === "") { vacios++; continue }
  lenDist.set(d.length, (lenDist.get(d.length) ?? 0) + 1)
  const arr = byDni.get(d)
  if (arr) arr.push(p)
  else byDni.set(d, [p])
}

let invalidValores = 0, invalidPacientes = 0
let dupGrupos = 0, dupPacientes = 0
const topRepetidos = []
const dupReales = []
for (const [d, grupo] of byDni) {
  topRepetidos.push({ dni: d, count: grupo.length })
  if (!dniValido(d)) {
    invalidValores++
    invalidPacientes += grupo.length
  } else if (grupo.length > 1) {
    dupGrupos++
    dupPacientes += grupo.length
    dupReales.push({ dni: d, count: grupo.length, nombres: grupo.map(nombreDe) })
  }
}
topRepetidos.sort((a, b) => b.count - a.count)
dupReales.sort((a, b) => b.count - a.count)

const pct = (n) => (total ? `${((n / total) * 100).toFixed(1)}%` : "0%")
const line = "=".repeat(60)
console.log("\n" + line)
console.log("DIAGNÓSTICO DE DNIs — Kinesiología Integral")
console.log(line)
console.log(`Pacientes totales:             ${total}`)
console.log(`DNI vacío:                     ${vacios} (${pct(vacios)})`)
console.log(`DNI inválido / de relleno:     ${invalidPacientes} pacientes en ${invalidValores} valores distintos`)
console.log(`DNI duplicado REAL (válido):   ${dupPacientes} pacientes en ${dupGrupos} grupos`)
const okUnicos = total - vacios - invalidPacientes - dupPacientes
console.log(`DNI válido y único:            ${okUnicos} (${pct(okUnicos)})`)

console.log("\nDistribución por longitud de DNI:")
for (const len of [...lenDist.keys()].sort((a, b) => a - b)) {
  console.log(`  ${String(len).padStart(2)} dígitos: ${lenDist.get(len)}`)
}

console.log("\nTop 25 DNIs más repetidos (probables valores de relleno):")
for (const { dni, count } of topRepetidos.slice(0, 25)) {
  if (count < 2) break
  const flag = dniValido(dni) ? "" : "  <- invalido/relleno"
  console.log(`  ${dni.padEnd(12)} ${String(count).padStart(4)} pacientes${flag}`)
}

console.log(`\nDuplicados REALES (DNI válido en 2+ pacientes) — ${dupReales.length} grupos:`)
for (const { dni, count, nombres } of dupReales.slice(0, 40)) {
  console.log(`  ${dni}  (${count}): ${nombres.slice(0, 5).join(" | ")}${count > 5 ? " ..." : ""}`)
}
if (dupReales.length > 40) console.log(`  ...y ${dupReales.length - 40} grupos mas`)

console.log("\n" + line)
console.log("Solo lectura — no se modifico ningun dato.")
process.exit(0)
