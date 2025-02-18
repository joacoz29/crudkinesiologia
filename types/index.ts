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
  tto?: string
  sesiones: string[]
  sesionesAux?: string[]
  ultima_actualizacion?: {
    fecha: string
    usuario: string
  }
} 