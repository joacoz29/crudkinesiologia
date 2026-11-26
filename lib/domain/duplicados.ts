// Dominio puro — clasificación de grupos de fichas con el mismo DNI.
//
// "misma_persona": apellido y primer nombre compatibles → fusionar es seguro.
// "revisar": nombres que no coinciden → casi siempre dos personas distintas con
// el DNI mal cargado; lo correcto es corregir el DNI, no fusionar.
// Ante la duda, "revisar" (el error caro es mezclar historias clínicas).

export type TipoDuplicado = "misma_persona" | "revisar"

const tokens = (s: string | undefined | null): string[] =>
  (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-zñ\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)

// Un conjunto de palabras contiene al otro ("garcia" ⊂ "garcia lopez")
const compatibles = (a: string[], b: string[]): boolean => {
  if (a.length === 0 || b.length === 0) return false
  const [chico, grande] = a.length <= b.length ? [a, b] : [b, a]
  return chico.every((t) => grande.includes(t))
}

// Mismo primer nombre, o el primer nombre de uno aparece en el otro ("maria" / "ana maria")
const nombresCompatibles = (a: string[], b: string[]): boolean =>
  a.length > 0 && b.length > 0 && (b.includes(a[0]) || a.includes(b[0]))

export function clasificarDuplicado(
  pacientes: { nombre?: string; apellido?: string }[],
): TipoDuplicado {
  const [base, ...resto] = pacientes
  const ap = tokens(base?.apellido)
  const no = tokens(base?.nombre)
  const ok = resto.every((p) => compatibles(ap, tokens(p.apellido)) && nombresCompatibles(no, tokens(p.nombre)))
  return ok ? "misma_persona" : "revisar"
}
