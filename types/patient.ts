// Define the structure for the nested 'ultima_actualizacion' object
interface UltimaActualizacion {
  fecha: string
  usuario: string
}

// Define the main patient data structure
export interface PacienteData {
  nombre: string
  apellido: string
  dni: string
  edad: string
  domicilio: string
  obraSocial: string
  nroAFL: string
  telefono: string
  diagnostico: string
  doctor: string
  sesiones: string[] | string
  anotaciones: string
  tratamiento: string
  sexo: string
  ultima_actualizacion: UltimaActualizacion
}

// Validation function to ensure all required fields are present and of the correct type
export function validatePacienteData(data: unknown): data is PacienteData {
  if (typeof data !== 'object' || data === null) {
    return false
  }

  const obj = data as Record<string, unknown>
  const requiredFields: (keyof PacienteData)[] = [
    "nombre",
    "apellido",
    "dni",
    "edad",
    "domicilio",
    "obraSocial",
    "nroAFL",
    "telefono",
    "diagnostico",
    "doctor",
    "sesiones",
    "anotaciones",
    "tratamiento",
    "sexo",
    "ultima_actualizacion",
  ]

  for (const field of requiredFields) {
    if (!(field in obj)) {
      return false
    }
  }

  if (!Array.isArray(obj.sesiones) && typeof obj.sesiones !== 'string') {
    return false
  }

  if (
    typeof obj.ultima_actualizacion !== "object" ||
    obj.ultima_actualizacion === null ||
    !("fecha" in obj.ultima_actualizacion) ||
    !("usuario" in obj.ultima_actualizacion)
  ) {
    return false
  }

  return true
}
