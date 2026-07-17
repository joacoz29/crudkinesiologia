---
name: kine-dev
description: Usar al desarrollar, diseñar o proponer features/cambios en crudkinesiologia (consultorio kinesiológico, Next.js 14 + Firebase RTDB). Codifica los tres pilares del proyecto — ideas sólidas con scope acotado, seguridad (reglas RTDB / admin SDK / no confiar en el cliente) y ahorro de datos (RTDB factura por GB descargado → reusar las cachés existentes) — más auditoría e integridad de escrituras. Invocar antes de escribir código de una feature nueva o de tocar un flujo existente.
---

# kine-dev — diseñar features para el consultorio sin romper costo, seguridad ni auditoría

Skill para acompañar el desarrollo de **crudkinesiologia** (gestión de Kinesiología Integral). Stack: Next.js 14 (App Router), Firebase RTDB (client SDK) + Firebase Auth, admin SDK para endpoints sensibles, ShadCN/Radix, TypeScript, Tailwind. Datos médicos reales de pacientes → cada decisión pasa por **costo de datos, seguridad y auditabilidad**.

## Flujo de trabajo

1. **Entender el pedido.** Identificá qué nodos de RTDB toca (`pacientes`, `turnos/{fecha}`, `libroDiario/{fecha}`, `logs/{mes}`, `opiniones/{mes}`, `config/*`) y si lee, escribe o ambos.
2. **Proponer, no encuestar.** Dar **1 recomendación clara** + a lo sumo 1 alternativa más liviana con su trade-off. Arrancar siempre por el **v1 mínimo viable** y dejar lo grande como extensión. No volcar un menú de 5 opciones.
3. **Pasar los 3 checklists de abajo ANTES de escribir** (Ahorro de datos · Seguridad · Auditoría/integridad). Si la idea choca con alguno, ajustar el diseño, no el chequeo.
4. **Reusar antes que crear.** La lib está partida por responsabilidad: `lib/domain/*` ((de)serialización pura, con tests), `lib/data/*` (lecturas/altas RTDB), `lib/flujo/asistencia.ts` (lógica clínica con escrituras), `lib/audit/log.ts` (writeLog), `lib/especialidades.ts` (registry por especialidad), más `lib/patients-store.ts`, `lib/monthly-cache.ts`, `lib/auth-helper.ts`. Buscá el patrón existente antes de inventar uno.
5. **Cerrar.** `npm test` + `npx tsc --noEmit` (lint no se usa), avisar si hay que **publicar reglas en Firebase Console**, y sugerir `/code-review` antes de commitear.

---

## Pilar 1 — Ahorro de datos (RTDB factura por GB DESCARGADO)

La regla de oro: **nunca volver a bajar lo que ya está en memoria.** Una lectura ingenua de una colección entera por cada búsqueda/montaje fue el bug de costo que motivó toda la capa de caché.

**Reusá la caché correcta según el dato:**

| Dato | Cómo leerlo | NO hacer |
|---|---|---|
| `pacientes` (colección) | `usePatients()` (suscripción live única) + `queryPatients(all, {search,page,limit})` en memoria | `get(ref(db,"pacientes"))` propio, ni pegarle a `/api/patients` (quedó sin consumidores) |
| Datos por mes (logs, opiniones, turnos del panel, libro para Datos) | `useCachedMonth(key, fetcher, {fallback, enabled, revalidate})` | re-fetch al togglear de vista o volver a un mes ya visto |
| Turnos del calendario | caché `turnos-cal/{yyyy-MM}` vía `loadTurnos`; mutación → `reloadTurnos`/`clearCachePrefix("turnos-cal/")` | bajar mes por mes al navegar |

**Principios:**
- **Clave de caché compartida** entre vistas que usan el mismo dato → cero fetch extra (ej.: `opiniones/{mes}` lo comparten la vista Opiniones y el KPI de satisfacción; `logs/{mes}` lo comparten Registro y "pacientes nuevos").
- **Mes pasado = inmutable** (logs append-only, opiniones cerradas) → cacheable para siempre. **Mes actual** → `revalidate: true`. Navegar al mes anterior debe reusar la misma key (`...-datos/{mesPrev}`).
- **Pasá datos por props, no re-fetchees.** Patrón ya usado: `turnosPorFecha` se reusa para mostrar la franja horaria ±2h sin lectura nueva; el chequeo de duplicado reusa `turnosEseDia`.
- **Query por rango de clave**, no "bajar todo y filtrar en memoria" (ej.: `fetchLibroDiarioPorRango(start,end)`, `fetchTurnosPorRango`).
- **Una sola lectura que devuelve todo lo derivado** en vez de varias (ej.: `fetchLibroDiarioPorRango` devuelve `{porDia, haberParticular, haberObraSocial, ...}` de una pasada).
- **Live (`onValue`) cuando hay que reflejar escrituras de otros** sin invalidación manual (pacientes). **Snapshot + caché de sesión** cuando el dato es estable por partición (meses).
- **Excepción deliberada:** el **libro diario NO se cachea** en lectura — es dato financiero que se escribe desde dos lados (auto-save propio + `confirmarAsistencia`/`addToLibroDiario` desde el calendario) sin señal confiable de invalidación cross-tab. Fetch fresco en cada montaje/cambio de fecha. No "optimizar" esto sin resolver la invalidación.
- Al mutar algo cacheado: `clearCachePrefix(prefix)` (sirve para un rango —ej. `turnos-cal/`— y también para una key puntual, pasando la key completa).

---

## Pilar 2 — Seguridad (datos médicos reales)

- **Reglas RTDB = deny por defecto.** `.read/.write: false` en la raíz; los datos solo con `auth != null`; `logs` y `opiniones` solo para los 5 emails admin; logs append-only (`.write: !data.exists()`). **Cualquier nodo nuevo necesita su entrada en `database.rules.json`.**
- **El archivo `database.rules.json` NO se despliega solo.** Hay que **publicarlo a mano en Firebase Console**. Si una feature agrega un nodo, decilo explícito en el cierre: "falta publicar reglas". Verificar en prod (read/write esperados dan 200 / lo prohibido da 401/403/404).
- **Nada público toca el client SDK directo.** Lo sin-cuenta (ej. `/opinion`) va por **API route con admin SDK** + validación + rate-limit por IP hasheada + dedup (patrón de `/api/opinion`: valida DNI contra pacientes, 1 cada 7 días, 10/h por IP). Nunca exponer datos de pacientes en un path legible sin auth.
- **No confiar en el cliente para autorización.** `isAdmin` y `ROLE_MAP` (`lib/auth-helper.ts`) son **solo UI** hoy — las reglas todavía no filtran por rol. No bases una garantía de seguridad en una comprobación client-side; si algo debe ser realmente admin-only, va por reglas o por API con token verificado. (Pendiente acordado: llevar roles a las reglas antes del endurecimiento pre-QR.)
- **Hoy NO hay endpoints autenticados:** las únicas API routes (`/api/opinion`, `/api/feriados`) son públicas y validan todo server-side. Si agregás un endpoint que toque datos de pacientes con identidad del usuario, verificá el ID token server-side con `verifyIdToken` (admin SDK) — todavía no existe un helper para eso.
- **Secretos** (service account, claves) en `.env.local` gitignoreado. Nunca commitear credenciales ni `claves-*.txt`. Si aparece un secreto en el diff, frená.
- **Input validation server-side** en todo lo público (DNI numérico/formato, rangos, longitudes).

---

## Pilar 3 — Auditoría e integridad de escrituras

- **Toda mutación de negocio se loguea.** `writeLog` en `lib/audit/log.ts` cubre pacientes (con diffs), turnos, confirmar/deshacer asistencia, libro diario, login/logout. **No escribir por fuera de los helpers que loguean** (ya se borraron helpers de turno que salteaban la auditoría — no reintroducir ese patrón). Acción dedicada + label + color por tipo de evento.
- **Escrituras multi-path = atómicas.** Si tocás más de un path, una sola `update(ref(db), { "a/x": v, "b/y": null })`. Patrones existentes: `confirmarAsistencia` (historial + tratamiento + estado turno + libro diario), reprogramar turno (mueve `turnos/{nueva}` + nulifica `turnos/{vieja}` con el mismo id), "eliminar próximos".
- **Idempotencia:** antes de mutar, releé el estado actual (guard de `confirmarAsistencia` relee el turno). Las acciones reversibles devuelven un payload `revert` para el "Deshacer" del toast (`desconfirmarAsistencia`, `deshacer_eliminar_turnos`).
- **Identidad estable, no índices.** IDs con `crypto.randomUUID()`; en mapas la clave es la identidad (lección del lost-update del libro: array→mapa `{entryId: entry}`, escritura por-entrada con diff contra `baselineRef`, nunca `set()` del nodo entero, que pisa lo que escribió otro en paralelo). Para orden estable de un mapa, campo explícito (`createdAt` epoch ms), no el orden lexicográfico de las claves.
- **Fechas en timezone Argentina** (`date-fns-tz`) para las claves `{yyyy-MM-dd}` y buckets `{yyyy-MM}`. Nunca UTC (corría al día siguiente después de las 21:00). Hay guard de fecha: no se marca asistencia/confirma en turnos futuros.
- **Guardá efectos secundarios DESPUÉS del éxito.** El log y el agregado al libro van después de que `onSave` devuelve `true`; sin cambios → sin log.

---

## Proponer ideas sólidas (estilo del proyecto)

- **v1 mínimo primero**, extensión después. Ej. acordado: tarifa por cobertura → arrancar con "una tarifa por sesión" configurable en `config/tarifas`, abrir por obra social después.
- **Anti lost-update por diseño:** ante multi-usuario, preferí escrituras por-entrada con blast radius mínimo (last-write-wins por fila, no por nodo).
- **Retrocompatibilidad:** datos legacy conviven (sesiones `string` vs `string[]`, libro array vs mapa, dni numérico). Normalizá al leer; que el diff no reescriba datos viejos sin cambio real.
- **Reflejá el trade-off** y mencioná la alternativa liviana descartada por si cambian de idea.
- Hay una lista de **mejoras pendientes** conocidas (mobile grilla apretada, autocompletar paciente en libro, dedup de `addToLibroDiario` por patientId, "copiar día anterior" buscando hacia atrás). Conectá la idea nueva con esa lista si aplica.

---

## Checklist de cierre (antes de dar por hecho)

- [ ] Reusé caché existente / no agregué una lectura de colección entera ni un re-fetch evitable.
- [ ] Toda escritura de negocio loguea (`writeLog`); multi-path es atómico; hay guard de idempotencia y revert si es reversible.
- [ ] Nodo nuevo → entrada en `database.rules.json` + **aviso de publicar en Firebase Console**; nada público sin admin SDK + validación + rate-limit.
- [ ] No apoyé seguridad en `isAdmin`/roles client-side; sin secretos en el diff.
- [ ] Fechas en timezone AR; retrocompat con datos legacy.
- [ ] `npm run lint` (+ `tsc --noEmit` si toqué tipos); sugerí `/code-review`.
