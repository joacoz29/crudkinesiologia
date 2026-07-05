export type TurnoEstado = "pendiente" | "asistio" | "ausente" | "cancelado"

export type Especialidad = "kinesiologia" | "traumatologia"

export interface Tratamiento {
  id: string
  nroAutorizacion: string
  sesionesAutorizadas: number
  fechaCreacion: string
  sesiones: string[]
  tratamiento?: string
  diagnostico?: string
  doctor?: string
}

export interface Turno {
  id: string
  patientId?: string
  nombre: string
  apellido: string
  hora: string
  notas?: string
  estado: TurnoEstado
  justificado?: boolean
  especialidad?: Especialidad // ausente = kinesiología (retrocompat)
}

export type TurnoConFecha = Turno & { fecha: string }

// Una consulta puntual de traumatología (una visita). El historial es la lista
// de estas entradas: cada vez que el paciente vuelve se agrega una nueva, no se
// pisa la anterior.
export interface TraumatologiaConsulta {
  id: string
  fecha: string // "yyyy-MM-dd" de la consulta
  diagnostico?: string
  notas: string
  usuario: string // quién la registró
  createdAt: number // epoch ms; ordena el historial
}

// Sección de traumatología dentro de la ficha compartida. La escribe el
// traumatólogo (y el admin); el resto la ve solo lectura. No toca los
// tratamientos/sesiones de kinesiología (modelo propio, ver [[traumatologia-feature]]).
export interface TraumatologiaFicha {
  consultas?: TraumatologiaConsulta[]
  // Legacy (previo al historial): un diagnóstico/nota plano que se pisaba en cada
  // visita. Al leer se pliega como una consulta más (ver parseConsultasTrauma).
  diagnostico?: string
  notas?: string
  ultima_actualizacion?: {
    fecha: string
    usuario: string
  }
}

export interface Patient {
  id: string
  nombre: string
  apellido: string
  edad: string
  fechaNacimiento?: string // "yyyy-MM-dd"; la edad mostrada se deriva de acá (edad queda como snapshot legacy)
  dni: string
  obraSocial: string
  nroAFL: string
  telefono: string
  diagnostico?: string
  doctor?: string
  sexo?: string
  domicilio?: string
  anotaciones?: string
  tratamiento?: string
  sesiones: string[]
  sesionesAutorizadas?: number
  nroAutorizacion?: string
  tratamientos?: Tratamiento[]
  createdAt?: number // epoch ms del alta; ordena la grilla por recién ingresados
  ultima_actualizacion?: {
    fecha: string
    usuario: string
  }
  traumatologia?: TraumatologiaFicha // sección del traumatólogo (2da especialidad)
}
