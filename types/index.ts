export type TurnoEstado = "pendiente" | "asistio" | "ausente" | "cancelado"

export interface Turno {
  id: string
  patientId?: string
  nombre: string
  apellido: string
  hora: string
  notas?: string
  estado: TurnoEstado
}

export interface Patient {
  id: string
  nombre: string
  apellido: string
  edad: string
  dni: string
  obraSocial: string
  nroAFL: string
  telefono: string
  diagnostico: string
  doctor: string
  sexo?: string
  domicilio?: string
  anotaciones?: string
  tratamiento?: string
  sesiones: string[]
  sesionesAux?: string[]
  sesionesAutorizadas?: number
  ultima_actualizacion?: {
    fecha: string
    usuario: string
  }
}
