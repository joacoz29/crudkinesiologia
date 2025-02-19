// Define the structure for the nested 'ultima_actualizacion' object
interface UltimaActualizacion {
  fecha: Date
  usuario: string
}

// Define the main patient data structure
export interface PacienteData {
  nombre: string
  apellido: string
  dni: string
  edad: number
  domicilio: string
  obraSocial: string
  nroAFL: string
  telefono: string
  correo: string
  diagnostico: string
  doctor: string
  sesiones: string[]
  especialidad: string
  anotaciones: string
  sexo: string
  tto: string
  ultima_actualizacion: UltimaActualizacion
}

// Validation function to ensure all required fields are present and of the correct type
export function validatePacienteData(data: any): data is PacienteData {
  const requiredFields: (keyof PacienteData)[] = [
    "nombre",
    "apellido",
    "dni",
    "edad",
    "domicilio",
    "obraSocial",
    "nroAFL",
    "telefono",
    "correo",
    "diagnostico",
    "doctor",
    "sesiones",
    "especialidad",
    "anotaciones",
    "sexo",
    "tto",
    "ultima_actualizacion",
  ]

  for (const field of requiredFields) {
    if (!(field in data)) {
      console.error(`Missing required field: ${field}`)
      return false
    }
  }

  if (typeof data.edad !== "number") {
    console.error('Field "edad" must be a number')
    return false
  }

  if (!Array.isArray(data.sesiones)) {
    console.error('Field "sesiones" must be an array')
    return false
  }

  if (
    typeof data.ultima_actualizacion !== "object" ||
    !("fecha" in data.ultima_actualizacion) ||
    !("usuario" in data.ultima_actualizacion)
  ) {
    console.error('Invalid "ultima_actualizacion" structure')
    return false
  }

  if (!(data.ultima_actualizacion.fecha instanceof Date)) {
    console.error('Field "ultima_actualizacion.fecha" must be a Date object')
    return false
  }

  return true
}

// Example usage of the PacienteData interface and validation function
export function createPaciente(data: PacienteData): PacienteData {
  if (!validatePacienteData(data)) {
    throw new Error("Invalid patient data")
  }
  return data
}

// Example of creating a patient record
const examplePaciente: PacienteData = {
  nombre: "Juan",
  apellido: "Pérez",
  dni: "12345678",
  edad: 35,
  domicilio: "Calle Principal 123",
  obraSocial: "OSDE",
  nroAFL: "AFL123456",
  telefono: "+54 11 1234-5678",
  correo: "juan.perez@email.com",
  diagnostico: "Lumbalgia",
  doctor: "Dr. García",
  sesiones: ["2023-05-01", "2023-05-08", "2023-05-15"],
  especialidad: "Kinesiología",
  anotaciones: "Paciente con dolor lumbar crónico",
  sexo: "Masculino",
  tto: "Terapia física y ejercicios de fortalecimiento",
  ultima_actualizacion: {
    fecha: new Date(),
    usuario: "admin",
  },
}

// Validate and create the patient record
try {
  const newPaciente = createPaciente(examplePaciente)
  console.log("Patient record created successfully:", newPaciente)
} catch (error) {
  console.error("Error creating patient record:", error instanceof Error ? error.message : String(error))
}

