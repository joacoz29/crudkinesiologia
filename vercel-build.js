// Verificar variables de entorno durante el build
const requiredEnvVars = [
  'FIREBASE_PROJECT_ID',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_PRIVATE_KEY',
  'FIREBASE_DATABASE_URL'
]

requiredEnvVars.forEach(envVar => {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`)
  }
  if (envVar === 'FIREBASE_PRIVATE_KEY') {
    console.log('FIREBASE_PRIVATE_KEY length:', process.env[envVar].length)
    console.log('FIREBASE_PRIVATE_KEY starts with:', process.env[envVar].substring(0, 27))
  } else {
    console.log(`${envVar}:`, process.env[envVar])
  }
}) 