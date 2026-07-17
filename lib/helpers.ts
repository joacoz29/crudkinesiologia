// ── Barrel del refactor R1/R2 (ver docs/architecture.md → obs #5/#6) ─────────
// El ex god-module quedó partido por responsabilidad:
//   lib/domain/*          → (de)serialización PURA, con tests (npm test)
//   lib/data/*            → acceso a RTDB (lecturas y altas puntuales)
//   lib/flujo/asistencia  → lógica clínica con escrituras multi-path atómicas
//   lib/audit/log         → writeLog y el vocabulario de acciones
// Este archivo solo re-exporta para que los consumidores sigan importando de
// "@/lib/helpers" sin cambios; la migración de imports directa es la etapa R3.
export * from "@/lib/domain/tiempo"
export * from "@/lib/domain/paciente"
export * from "@/lib/domain/trauma"
export * from "@/lib/domain/libro"
export * from "@/lib/data/turnos"
export * from "@/lib/data/libro"
export * from "@/lib/data/opiniones-logs"
export * from "@/lib/flujo/asistencia"
export * from "@/lib/audit/log"
