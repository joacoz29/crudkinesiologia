// Sugerencias y reportes que el equipo le deja a Anita. Se guardan por mes
// (sugerencias/{yyyy-MM}/{id}, hora AR) como logs/opiniones: el panel de admin
// baja solo el mes que mira. Escribe cualquier usuario logueado (solo altas);
// leen y cambian el estado los admins (ver database.rules.json).

import { ref, get, push, update } from "firebase/database"
import { formatInTimeZone } from "date-fns-tz"
import { db, auth } from "@/lib/firebase"
import { getUserDisplayName } from "@/lib/auth-helper"
import { TZ } from "@/lib/domain/tiempo"

export type TipoSugerencia = "mejora" | "problema" | "otro"
export type EstadoSugerencia = "nueva" | "leida" | "resuelta"

export const TIPO_SUGERENCIA_LABEL: Record<TipoSugerencia, string> = {
  mejora: "Sugerencia / mejora",
  problema: "Algo no funcionó",
  otro: "Otro",
}

export interface Sugerencia {
  id: string
  tipo: TipoSugerencia
  texto: string
  email: string
  nombre: string
  creadoEn: string
  pestana?: string
  estado: EstadoSugerencia
}

export const MAX_TEXTO_SUGERENCIA = 1000

export const mesSugerencias = (d = new Date()) => formatInTimeZone(d, TZ, "yyyy-MM")

export async function enviarSugerencia(s: { tipo: TipoSugerencia; texto: string; pestana?: string }) {
  const user = auth.currentUser
  if (!user?.email) throw new Error("SIN_SESION")
  await push(ref(db, `sugerencias/${mesSugerencias()}`), {
    tipo: s.tipo,
    texto: s.texto.trim().slice(0, MAX_TEXTO_SUGERENCIA),
    email: user.email,
    nombre: getUserDisplayName(user),
    creadoEn: new Date().toISOString(),
    ...(s.pestana && { pestana: s.pestana }),
    estado: "nueva",
  })
}

export async function fetchSugerenciasMes(mesKey: string): Promise<Sugerencia[]> {
  const snap = await get(ref(db, `sugerencias/${mesKey}`))
  if (!snap.exists()) return []
  return Object.entries(snap.val() as Record<string, Omit<Sugerencia, "id">>)
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.creadoEn.localeCompare(a.creadoEn))
}

export async function marcarSugerencia(mesKey: string, id: string, estado: EstadoSugerencia) {
  await update(ref(db, `sugerencias/${mesKey}/${id}`), { estado })
}
