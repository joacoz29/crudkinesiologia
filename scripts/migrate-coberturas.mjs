// Migración de coberturas "particular" — FASE 1: DRY RUN (SOLO LECTURA, no escribe).
//
// Reporta los casos donde la obra social es "particular" (vacío, "-" o el texto
// "PARTICULAR") pero quedó mal guardada:
//   A) Entradas del libro diario con cobertura "Obra Social" y/o obraSocial != "-".
//   B) Fichas de pacientes con obraSocial = "PARTICULAR" (el texto), que sería
//      lo que conviene normalizar a "-" (la raíz del problema).
//
// Con estos números se decide si aplicar la fase 2 (escritura). Este script NO
// modifica nada.
//
// Uso:
//   1. Credenciales en .env.local (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL,
//      FIREBASE_PRIVATE_KEY, FIREBASE_DATABASE_URL) — las mismas que usa Vercel.
//   2. node scripts/migrate-coberturas.mjs

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

// Mismo criterio que lib/helpers.ts (mantener en sync)
const norm = (os) => String(os ?? "").trim().toLowerCase()
const esParticular = (os) => { const t = norm(os); return t === "" || t === "-" || t === "particular" }
const esTextoParticular = (os) => norm(os) === "particular"
const nombreDe = (p) => `${p?.nombre ?? ""} ${p?.apellido ?? ""}`.trim() || "(sin nombre)"
const line = "=".repeat(64)

// ─────────────────────────── A) Libro diario ───────────────────────────
console.log("Leyendo libroDiario…")
const libro = (await getDatabase().ref("libroDiario").once("value")).val() ?? {}

let dias = 0
let totalEntradas = 0
let entradasPaciente = 0
let libroFix = 0
let porTexto = 0   // obraSocial "PARTICULAR"
let porVacio = 0   // obraSocial ""
let porGuion = 0   // obraSocial "-" pero cobertura mal
const diasAfectados = new Set()
const ejLibro = []

for (const [fecha, dia] of Object.entries(libro)) {
  dias++
  const raw = dia?.entradas
  const entradas = Array.isArray(raw) ? raw : Object.values(raw ?? {})
  for (const e of entradas) {
    if (!e) continue
    totalEntradas++
    if ((e.tipo ?? "Paciente") !== "Paciente") continue // Gasto/Ingreso no aplican
    entradasPaciente++
    const os = e.obraSocial
    if (!esParticular(os)) continue
    const coberturaMal = e.cobertura !== "Particular"
    const osMal = String(os ?? "") !== "-"
    if (!coberturaMal && !osMal) continue // ya está canónico
    libroFix++
    diasAfectados.add(fecha)
    const t = norm(os)
    if (t === "particular") porTexto++
    else if (t === "") porVacio++
    else porGuion++
    if (ejLibro.length < 15) ejLibro.push({ fecha, nombre: e.nombreApellido ?? "(sin nombre)", cobertura: e.cobertura ?? "—", os: String(os ?? "") })
  }
}

// ─────────────────────────── B) Pacientes ───────────────────────────
console.log("Leyendo pacientes…")
const pacRaw = (await getDatabase().ref("pacientes").once("value")).val() ?? {}
const pacientes = Object.values(pacRaw)
let pacTexto = 0  // obraSocial "PARTICULAR" (se normalizaría a "-")
let pacVacio = 0  // obraSocial "" (dato faltante, NO se migra)
const ejPac = []
for (const p of pacientes) {
  if (esTextoParticular(p?.obraSocial)) { pacTexto++; if (ejPac.length < 15) ejPac.push(nombreDe(p)) }
  else if (norm(p?.obraSocial) === "") pacVacio++
}

// ─────────────────────────── Reporte ───────────────────────────
console.log("\n" + line)
console.log("DRY RUN — COBERTURAS 'PARTICULAR' MAL GUARDADAS (Kinesiología Integral)")
console.log(line)

console.log("\nA) LIBRO DIARIO")
console.log(`  Días leídos:                    ${dias}`)
console.log(`  Entradas totales:               ${totalEntradas}  (de paciente: ${entradasPaciente})`)
console.log(`  Entradas a normalizar:          ${libroFix}  en ${diasAfectados.size} día${diasAfectados.size !== 1 ? "s" : ""}`)
console.log(`      · obraSocial "PARTICULAR":  ${porTexto}`)
console.log(`      · obraSocial vacía:         ${porVacio}`)
console.log(`      · obraSocial "-" pero cobertura mal: ${porGuion}`)
console.log(`  Acción (fase 2): cobertura -> "Particular", obraSocial -> "-"`)
if (ejLibro.length) {
  console.log("\n  Ejemplos:")
  for (const e of ejLibro) console.log(`    ${e.fecha}  ${e.nombre.padEnd(28)} cob="${e.cobertura}" os="${e.os}"`)
}

console.log("\nB) FICHAS DE PACIENTES")
console.log(`  Pacientes totales:              ${pacientes.length}`)
console.log(`  Con obraSocial "PARTICULAR":    ${pacTexto}   (se normalizarían a "-")`)
console.log(`  Con obraSocial vacía:           ${pacVacio}   (dato faltante — NO se migra)`)
if (ejPac.length) {
  console.log("\n  Ejemplos:")
  for (const n of ejPac) console.log(`    ${n}`)
}

console.log("\n" + line)
console.log("SOLO LECTURA — no se modificó ningún dato. (Fase 2 = escritura, aún no.)")
process.exit(0)
