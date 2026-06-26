"use client"

import { useMemo, useState } from "react"
import { format, parseISO, startOfMonth, endOfMonth, subMonths, getDay, getDaysInMonth } from "date-fns"
import { es } from "date-fns/locale"
import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"
import { CalendarCheck, TrendingUp, UserX, Wallet, Inbox, AlertTriangle, Banknote, ArrowDownCircle, Coins, Star, ArrowUp, ArrowDown, UserPlus, Activity, Users, Stethoscope, Download } from "lucide-react"
import { fetchTurnosPorRango, fetchLibroDiarioPorRango, fetchOpinionesMes, fetchLogsMes, getSessionStats, type Opinion, type LibroResumen } from "@/lib/helpers"
import { usePatients } from "@/lib/patients-store"
import { useCachedMonth } from "@/lib/monthly-cache"
import { rankDerivantes } from "@/lib/doctores"
import { Button } from "@/components/ui/button"
import { Patient, Turno } from "@/types"

const EMPTY_LIBRO: LibroResumen = { porDia: {}, haberParticular: 0, haberObraSocial: 0, haberIngreso: 0, debeGasto: 0 }

// Vistas del gráfico de movimiento diario (toggle interactivo)
const VISTAS_RECAUD = [
  { k: "saldo", label: "Saldo" },
  { k: "haber", label: "Recaudado" },
  { k: "debe", label: "Egresos" },
  { k: "acum", label: "Acumulado" },
] as const
type VistaRecaud = (typeof VISTAS_RECAUD)[number]["k"]

// Variación porcentual vs mes anterior (null si no hay base de comparación)
function pctCambio(actual: number, anterior: number): number | null {
  if (!anterior) return null
  return ((actual - anterior) / anterior) * 100
}

function Trend({ pct, higherIsBetter = true }: { pct: number | null; higherIsBetter?: boolean }) {
  if (pct === null || !isFinite(pct)) return null
  if (Math.abs(pct) < 0.5) return <span className="text-[10px] text-slate-400 whitespace-nowrap">≈ mes ant.</span>
  const sube = pct > 0
  const bueno = higherIsBetter ? sube : !sube
  const Icon = sube ? ArrowUp : ArrowDown
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[10px] font-semibold whitespace-nowrap ${bueno ? "text-emerald-600" : "text-red-500"}`}
      title="vs mes anterior"
    >
      <Icon className="h-3 w-3" />
      {Math.abs(pct).toFixed(0)}%
    </span>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 pt-1">{children}</h3>
}

// Formato de moneda argentino: $1.234,56
function formatMoney(n: number): string {
  return `$${n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// Escalares de un mes para comparar tendencias
function resumenMes(
  turnosPorDia: Record<string, Turno[]>,
  libroPorDia: Record<string, { haber: number; debe: number }>,
): { atenciones: number; ausentismo: number; recaudado: number; egresos: number; saldo: number; activos: number } {
  let asistidos = 0
  let ausentes = 0
  const activos = new Set<string>()
  for (const turnos of Object.values(turnosPorDia)) {
    for (const t of turnos) {
      if (t.estado === "asistio") {
        asistidos++
        activos.add(t.patientId ?? `${t.nombre} ${t.apellido}`.toLowerCase().trim())
      } else if (t.estado === "ausente") ausentes++
    }
  }
  const concluidos = asistidos + ausentes
  let haber = 0
  let debe = 0
  for (const l of Object.values(libroPorDia)) { haber += l.haber; debe += l.debe }
  return {
    atenciones: asistidos,
    ausentismo: concluidos ? (ausentes / concluidos) * 100 : 0,
    recaudado: haber,
    egresos: debe,
    saldo: haber - debe,
    activos: activos.size,
  }
}

const DIAS_SEMANA = [
  { label: "Lun", value: 1 },
  { label: "Mar", value: 2 },
  { label: "Mié", value: 3 },
  { label: "Jue", value: 4 },
  { label: "Vie", value: 5 },
  { label: "Sáb", value: 6 },
]
const HORAS = Array.from({ length: 12 }, (_, i) => 8 + i) // 8:00 a 19:00 (agenda diaria)

// "-" o vacío es la convención de paciente particular (misma regla que el libro diario)
function esParticular(obraSocial: string | undefined): boolean {
  const t = (obraSocial ?? "").trim()
  return !t || t === "-"
}

function StatCard({
  icon: Icon,
  label,
  value,
  detail,
  trend,
}: {
  icon: typeof CalendarCheck
  label: string
  value: string
  detail: string
  trend?: React.ReactNode
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 px-4 py-3 shadow-sm flex items-center gap-3">
      <div className="h-9 w-9 rounded-xl bg-[#001633]/5 flex items-center justify-center shrink-0">
        <Icon className="h-5 w-5 text-[#001633]" />
      </div>
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <p className="text-xl font-semibold text-slate-800 leading-tight tabular-nums">{value}</p>
          {trend}
        </div>
        <p className="text-xs text-slate-400 truncate">
          <span className="font-medium text-slate-500">{label}</span> · {detail}
        </p>
      </div>
    </div>
  )
}

const MONEY_TONES = {
  green: { bg: "bg-emerald-50", icon: "text-emerald-600", value: "text-emerald-700" },
  orange: { bg: "bg-orange-50", icon: "text-orange-600", value: "text-orange-700" },
  red: { bg: "bg-red-50", icon: "text-red-600", value: "text-red-700" },
  slate: { bg: "bg-[#001633]/5", icon: "text-[#001633]", value: "text-slate-800" },
}

function MoneyCard({
  icon: Icon,
  label,
  value,
  detail,
  tone,
  trend,
}: {
  icon: typeof CalendarCheck
  label: string
  value: string
  detail: string
  tone: keyof typeof MONEY_TONES
  trend?: React.ReactNode
}) {
  const t = MONEY_TONES[tone]
  return (
    <div className="bg-white rounded-2xl border border-slate-200 px-4 py-3 shadow-sm flex items-center gap-3">
      <div className={`h-9 w-9 rounded-xl ${t.bg} flex items-center justify-center shrink-0`}>
        <Icon className={`h-5 w-5 ${t.icon}`} />
      </div>
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <p className={`text-lg font-semibold leading-tight tabular-nums truncate ${t.value}`}>{value}</p>
          {trend}
        </div>
        <p className="text-xs text-slate-400 truncate">
          <span className="font-medium text-slate-500">{label}</span> · {detail}
        </p>
      </div>
    </div>
  )
}

export function AdminDatos({ currentMonth }: { currentMonth: Date }) {
  // Caché compartida: reusa la suscripción live de pacientes (no baja la colección de nuevo)
  const { patients, isLoading: isLoadingPatients } = usePatients()

  // Estado del gráfico interactivo de recaudación (vista elegida + día en hover)
  const [vistaRecaud, setVistaRecaud] = useState<VistaRecaud>("saldo")
  const [hoverDia, setHoverDia] = useState<number | null>(null)

  const mesKey = format(currentMonth, "yyyy-MM")
  const hoyMesKey = format(new Date(), "yyyy-MM")
  const esMesActual = mesKey === hoyMesKey

  const prevMonth = subMonths(currentMonth, 1)
  const prevMesKey = format(prevMonth, "yyyy-MM")
  const prevEsMesActual = prevMesKey === hoyMesKey

  const rango = (m: Date): [string, string] => [
    format(startOfMonth(m), "yyyy-MM-dd"),
    format(endOfMonth(m), "yyyy-MM-dd"),
  ]

  // Turnos del mes cacheados por sesión (revalida solo el mes actual). Así
  // togglear de vista no re-baja los turnos de meses pasados.
  const { data: turnosPorDia, isLoading: isLoadingTurnos } = useCachedMonth<Record<string, Turno[]>>(
    `turnos-datos/${mesKey}`,
    () => fetchTurnosPorRango(...rango(currentMonth)),
    { revalidate: esMesActual, fallback: {} },
  )

  // Recaudación del mes desde el libro diario (haber/debe por día + desglose), cacheada
  const { data: libro, isLoading: isLoadingLibro } = useCachedMonth<LibroResumen>(
    `libro-datos/${mesKey}`,
    () => fetchLibroDiarioPorRango(...rango(currentMonth)),
    { revalidate: esMesActual, fallback: EMPTY_LIBRO },
  )

  // Mes anterior (para tendencias). Misma key/forma que arriba → comparten caché.
  const { data: turnosPrev } = useCachedMonth<Record<string, Turno[]>>(
    `turnos-datos/${prevMesKey}`,
    () => fetchTurnosPorRango(...rango(prevMonth)),
    { revalidate: prevEsMesActual, fallback: {} },
  )
  const { data: libroPrev } = useCachedMonth<LibroResumen>(
    `libro-datos/${prevMesKey}`,
    () => fetchLibroDiarioPorRango(...rango(prevMonth)),
    { revalidate: prevEsMesActual, fallback: EMPTY_LIBRO },
  )

  // Opiniones del mes (satisfacción). Misma key que la vista Opiniones → caché compartida.
  const { data: opiniones } = useCachedMonth<Opinion[]>(
    `opiniones/${mesKey}`,
    () => fetchOpinionesMes(mesKey),
    { revalidate: esMesActual, fallback: [] },
  )

  // Logs del mes (pacientes nuevos). Misma key que la vista Registro → caché compartida.
  const { data: logs } = useCachedMonth(
    `logs/${mesKey}`,
    () => fetchLogsMes(mesKey),
    { revalidate: esMesActual, fallback: [] },
  )
  const { data: logsPrev } = useCachedMonth(
    `logs/${prevMesKey}`,
    () => fetchLogsMes(prevMesKey),
    { revalidate: prevEsMesActual, fallback: [] },
  )

  const isLoading = isLoadingTurnos || isLoadingPatients || isLoadingLibro

  // Resumen del mes anterior (tendencias), satisfacción y pacientes nuevos
  const prev = useMemo(() => resumenMes(turnosPrev, libroPrev.porDia), [turnosPrev, libroPrev])
  const satisfaccion = useMemo(() => {
    if (!opiniones.length) return { promedio: 0, count: 0 }
    return { promedio: opiniones.reduce((s, o) => s + o.rating, 0) / opiniones.length, count: opiniones.length }
  }, [opiniones])
  const pacientesNuevos = useMemo(() => logs.filter((l) => l.accion === "crear_paciente").length, [logs])
  const pacientesNuevosPrev = useMemo(() => logsPrev.filter((l) => l.accion === "crear_paciente").length, [logsPrev])

  // Origen de la recaudación (haber) por cobertura/tipo
  const fuentesRecaud = useMemo(() => {
    const fuentes = [
      { label: "Particular", monto: libro.haberParticular, color: "bg-emerald-500" },
      { label: "Obra Social", monto: libro.haberObraSocial, color: "bg-[#001633]" },
      { label: "Ingresos varios", monto: libro.haberIngreso, color: "bg-sky-500" },
    ].filter((f) => f.monto > 0)
    return { fuentes, max: Math.max(1, ...fuentes.map((f) => f.monto)) }
  }, [libro])

  // Demografía y derivantes (sobre toda la base de pacientes, no depende del mes)
  const perfil = useMemo(() => {
    let masculino = 0
    let femenino = 0
    let otroSexo = 0
    const edadBuckets = [
      { rango: "0-17", min: 0, max: 17, count: 0 },
      { rango: "18-30", min: 18, max: 30, count: 0 },
      { rango: "31-45", min: 31, max: 45, count: 0 },
      { rango: "46-60", min: 46, max: 60, count: 0 },
      { rango: "60+", min: 61, max: Infinity, count: 0 },
    ]
    let sinEdad = 0
    const docList: string[] = []
    for (const p of patients) {
      const s = (p.sexo ?? "").trim().toLowerCase()
      if (s.startsWith("m")) masculino++
      else if (s.startsWith("f")) femenino++
      else if (s) otroSexo++

      const edad = parseInt(p.edad, 10)
      if (Number.isNaN(edad) || edad <= 0) sinEdad++
      else (edadBuckets.find((b) => edad >= b.min && edad <= b.max) ?? edadBuckets[4]).count++

      if (p.doctor) docList.push(p.doctor)
    }
    const maxEdad = Math.max(1, ...edadBuckets.map((b) => b.count))
    // Fusiona variantes de tipeo del mismo médico ("Gurpide Gustavo" vs
    // "GUSTAVO GURPIDE" → una sola entrada). Ver lib/doctores.ts.
    const derivantesRank = rankDerivantes(docList).slice(0, 6)
    const conSexo = masculino + femenino + otroSexo
    return { masculino, femenino, otroSexo, conSexo, edadBuckets, maxEdad, sinEdad, derivantesRank, total: patients.length }
  }, [patients])

  const metrics = useMemo(() => {
    const patientById = new Map(patients.map((p) => [p.id, p]))
    const patientByName = new Map(
      patients.map((p) => [`${p.nombre} ${p.apellido}`.toLowerCase().trim(), p])
    )
    const pacienteDe = (t: Turno): Patient | undefined =>
      (t.patientId && patientById.get(t.patientId)) ||
      patientByName.get(`${t.nombre} ${t.apellido}`.toLowerCase().trim())

    const todos: Array<Turno & { fecha: string }> = []
    for (const [fecha, turnos] of Object.entries(turnosPorDia)) {
      for (const t of turnos) todos.push({ ...t, fecha })
    }

    const asistidos = todos.filter((t) => t.estado === "asistio")
    const ausentes = todos.filter((t) => t.estado === "ausente")
    const justificadas = ausentes.filter((t) => t.justificado).length
    const concluidos = asistidos.length + ausentes.length
    const ausentismo = concluidos ? (ausentes.length / concluidos) * 100 : 0

    // Pacientes activos (distintos atendidos) y sesiones promedio por paciente
    const activosSet = new Set(
      asistidos.map((t) => t.patientId ?? `${t.nombre} ${t.apellido}`.toLowerCase().trim())
    )
    const pacientesActivos = activosSet.size
    const sesionesPromedio = pacientesActivos ? asistidos.length / pacientesActivos : 0

    // Atenciones por día del mes (incluye días en 0)
    const diasDelMes = getDaysInMonth(currentMonth)
    const base = format(currentMonth, "yyyy-MM")
    const porDia = Array.from({ length: diasDelMes }, (_, i) => {
      const fecha = `${base}-${String(i + 1).padStart(2, "0")}`
      return {
        dia: i + 1,
        fecha,
        weekday: getDay(parseISO(fecha)),
        count: (turnosPorDia[fecha] ?? []).filter((t) => t.estado === "asistio").length,
      }
    })
    const maxDia = Math.max(1, ...porDia.map((d) => d.count))
    const diasConAtencion = porDia.filter((d) => d.count > 0).length
    const promedioPorDia = diasConAtencion ? asistidos.length / diasConAtencion : 0

    // Distribución por cobertura (sobre atenciones; agrupa case-insensitive)
    const porObraSocial = new Map<string, { label: string; count: number }>()
    let particulares = 0
    let conCobertura = 0
    let sinIdentificar = 0
    for (const t of asistidos) {
      const p = pacienteDe(t)
      if (!p) { sinIdentificar++; continue }
      conCobertura++
      const particular = esParticular(p.obraSocial)
      if (particular) particulares++
      const key = particular ? "particular" : p.obraSocial.trim().toLowerCase()
      const cur = porObraSocial.get(key)
      if (cur) cur.count++
      else porObraSocial.set(key, { label: particular ? "Particular" : p.obraSocial.trim(), count: 1 })
    }
    const obraSocialRanking = Array.from(porObraSocial.values()).sort((a, b) => b.count - a.count)
    const pctParticular = conCobertura ? (particulares / conCobertura) * 100 : 0

    // Ocupación hora × día de semana (todo turno no cancelado)
    const heatmap = new Map<string, number>()
    for (const t of todos) {
      if (t.estado === "cancelado") continue
      const hora = parseInt(t.hora, 10)
      if (Number.isNaN(hora) || hora < HORAS[0] || hora > HORAS[HORAS.length - 1]) continue
      const wd = getDay(parseISO(t.fecha))
      const key = `${wd}-${hora}`
      heatmap.set(key, (heatmap.get(key) ?? 0) + 1)
    }
    const maxHeat = Math.max(1, ...Array.from(heatmap.values()))

    // Inasistentes del mes
    const faltasPorPaciente = new Map<string, { nombre: string; faltas: number; justificadas: number }>()
    for (const t of ausentes) {
      const key = t.patientId ?? `${t.nombre} ${t.apellido}`.toLowerCase().trim()
      const cur = faltasPorPaciente.get(key) ?? { nombre: `${t.nombre} ${t.apellido}`, faltas: 0, justificadas: 0 }
      cur.faltas++
      if (t.justificado) cur.justificadas++
      faltasPorPaciente.set(key, cur)
    }
    const inasistentes = Array.from(faltasPorPaciente.values())
      .sort((a, b) => b.faltas - a.faltas)
      .slice(0, 8)

    // Sesiones por agotar (estado actual, no depende del mes)
    const porAgotar = patients
      .map((p) => ({ p, stats: getSessionStats(p) }))
      .filter((x): x is { p: Patient; stats: { used: number; authorized: number } } =>
        x.stats !== null && x.stats.authorized - x.stats.used <= 2
      )
      .map(({ p, stats }) => ({
        nombre: `${p.nombre} ${p.apellido}`,
        telefono: p.telefono,
        used: stats.used,
        authorized: stats.authorized,
        restantes: stats.authorized - stats.used,
      }))
      .sort((a, b) => a.restantes - b.restantes || a.nombre.localeCompare(b.nombre))

    // Recaudación del mes (libro diario): saldo diario = haber - debe
    const recaudPorDia = porDia.map(({ dia, fecha, weekday }) => {
      const l = libro.porDia[fecha]
      const haber = l?.haber ?? 0
      const debe = l?.debe ?? 0
      return { dia, fecha, weekday, haber, debe, saldo: haber - debe }
    })
    const totalHaber = recaudPorDia.reduce((s, d) => s + d.haber, 0)
    const totalDebe = recaudPorDia.reduce((s, d) => s + d.debe, 0)
    const saldoMes = totalHaber - totalDebe
    const diasConMovimiento = recaudPorDia.filter((d) => d.haber !== 0 || d.debe !== 0).length
    const promedioRecaud = diasConMovimiento ? totalHaber / diasConMovimiento : 0
    const maxSaldoAbs = Math.max(1, ...recaudPorDia.map((d) => Math.abs(d.saldo)))
    const mejorDia = recaudPorDia.reduce<typeof recaudPorDia[number] | null>(
      (best, d) => (d.saldo > 0 && (!best || d.saldo > best.saldo) ? d : best),
      null,
    )
    const hayRecaudacion = totalHaber !== 0 || totalDebe !== 0

    // Ticket promedio (recaudado por atención) y recaudación por día de semana
    const ticketPromedio = asistidos.length ? totalHaber / asistidos.length : 0
    const haberPorWeekday = new Map<number, number>()
    for (const d of recaudPorDia) haberPorWeekday.set(d.weekday, (haberPorWeekday.get(d.weekday) ?? 0) + d.haber)
    const recaudSemana = DIAS_SEMANA.map(({ label, value }) => ({ label, haber: haberPorWeekday.get(value) ?? 0 }))
    const maxSemana = Math.max(1, ...recaudSemana.map((s) => s.haber))

    return {
      atenciones: asistidos.length,
      ausencias: ausentes.length,
      justificadas,
      ausentismo,
      pacientesActivos,
      sesionesPromedio,
      porDia,
      maxDia,
      diasConAtencion,
      promedioPorDia,
      obraSocialRanking,
      sinIdentificar,
      pctParticular,
      heatmap,
      maxHeat,
      inasistentes,
      porAgotar,
      recaudPorDia,
      totalHaber,
      totalDebe,
      saldoMes,
      diasConMovimiento,
      promedioRecaud,
      maxSaldoAbs,
      mejorDia,
      hayRecaudacion,
      ticketPromedio,
      recaudSemana,
      maxSemana,
      sinTurnos: todos.length === 0,
    }
  }, [turnosPorDia, libro, patients, currentMonth])

  // Serie del gráfico de movimiento diario según la vista elegida (saldo/haber/debe/acumulado)
  const serieRecaud = useMemo(() => {
    const dias = metrics.recaudPorDia
    if (vistaRecaud === "acum") {
      let acc = 0
      const vals = dias.map((d) => (acc += d.haber))
      return { puntos: dias.map((d, i) => ({ dia: d.dia, fecha: d.fecha, val: vals[i] })), max: Math.max(1, ...vals) }
    }
    const pick = (d: (typeof dias)[number]) =>
      vistaRecaud === "haber" ? d.haber : vistaRecaud === "debe" ? d.debe : d.saldo
    return {
      puntos: dias.map((d) => ({ dia: d.dia, fecha: d.fecha, val: pick(d) })),
      max: Math.max(1, ...dias.map((d) => Math.abs(pick(d)))),
    }
  }, [metrics.recaudPorDia, vistaRecaud])

  const mesNombre = format(currentMonth, "MMMM", { locale: es })
  const mesLabel = format(currentMonth, "MMMM yyyy", { locale: es })

  const exportarPDF = () => {
    try {
      const doc = new jsPDF()
      doc.setFontSize(15)
      doc.text("Kinesiología Integral — Datos del consultorio", 14, 16)
      doc.setFontSize(11)
      doc.setTextColor(120)
      doc.text(mesLabel.charAt(0).toUpperCase() + mesLabel.slice(1), 14, 23)
      doc.setTextColor(0)

      const azul: [number, number, number] = [0, 22, 51]
      autoTable(doc, {
        startY: 30,
        head: [["Resumen del mes", "Valor"]],
        body: [
          ["Atenciones", String(metrics.atenciones)],
          ["Promedio por día", metrics.promedioPorDia.toFixed(1)],
          ["Ausentismo", `${metrics.ausentismo.toFixed(0)}% (${metrics.ausencias} faltas, ${metrics.justificadas} justif.)`],
          ["Atenciones particulares", `${metrics.pctParticular.toFixed(0)}%`],
          ["Satisfacción", satisfaccion.count ? `${satisfaccion.promedio.toFixed(1)} / 5 (${satisfaccion.count} opiniones)` : "Sin opiniones"],
          ["Pacientes nuevos", String(pacientesNuevos)],
          ["Pacientes activos", String(metrics.pacientesActivos)],
          ["Sesiones por paciente", metrics.sesionesPromedio.toFixed(1)],
        ],
        headStyles: { fillColor: azul },
      })

      type DocWithTable = jsPDF & { lastAutoTable: { finalY: number } }
      let y = (doc as DocWithTable).lastAutoTable.finalY + 8

      if (metrics.hayRecaudacion) {
        autoTable(doc, {
          startY: y,
          head: [["Recaudación", "Monto"]],
          body: [
            ["Recaudado (Haber)", formatMoney(metrics.totalHaber)],
            ["Egresos (Debe)", formatMoney(metrics.totalDebe)],
            ["Saldo neto", formatMoney(metrics.saldoMes)],
            ["Ticket promedio", formatMoney(metrics.ticketPromedio)],
            ["— Particular", formatMoney(libro.haberParticular)],
            ["— Obra Social", formatMoney(libro.haberObraSocial)],
            ["— Ingresos varios", formatMoney(libro.haberIngreso)],
          ],
          headStyles: { fillColor: azul },
        })
        y = (doc as DocWithTable).lastAutoTable.finalY + 8
      }

      if (metrics.porAgotar.length > 0) {
        autoTable(doc, {
          startY: y,
          head: [["Sesiones por agotar", "Usadas", "Restantes"]],
          body: metrics.porAgotar.map((p) => [
            p.nombre,
            `${p.used}/${p.authorized}`,
            p.restantes <= 0 ? "Agotadas" : String(p.restantes),
          ]),
          headStyles: { fillColor: azul },
        })
      }

      doc.save(`Datos_${mesKey}.pdf`)
    } catch {
      // no romper la UI si falla la generación
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 bg-white rounded-2xl border border-slate-200 shadow-sm animate-pulse" />
          ))}
        </div>
        <div className="h-56 bg-white rounded-2xl border border-slate-200 shadow-sm animate-pulse" />
        <div className="grid md:grid-cols-2 gap-3">
          <div className="h-64 bg-white rounded-2xl border border-slate-200 shadow-sm animate-pulse" />
          <div className="h-64 bg-white rounded-2xl border border-slate-200 shadow-sm animate-pulse" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={exportarPDF}
          className="border-[#001633] text-[#001633] hover:bg-[#001633] hover:text-white flex items-center gap-1.5"
        >
          <Download className="h-4 w-4" />
          Exportar PDF
        </Button>
      </div>

      {metrics.sinTurnos ? (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm px-4 py-16 text-center">
          <Inbox className="h-8 w-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-400">Sin turnos registrados en {mesNombre}</p>
        </div>
      ) : (
        <>
          {/* Resumen del mes */}
          <SectionTitle>Resumen del mes</SectionTitle>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <StatCard
              icon={CalendarCheck}
              label="Atenciones"
              value={String(metrics.atenciones)}
              detail={`en ${mesNombre}`}
              trend={<Trend pct={pctCambio(metrics.atenciones, prev.atenciones)} />}
            />
            <StatCard
              icon={TrendingUp}
              label="Promedio por día"
              value={metrics.promedioPorDia.toFixed(1)}
              detail={`${metrics.diasConAtencion} día${metrics.diasConAtencion !== 1 ? "s" : ""} con atención`}
            />
            <StatCard
              icon={UserX}
              label="Ausentismo"
              value={`${metrics.ausentismo.toFixed(0)}%`}
              detail={`${metrics.ausencias} falta${metrics.ausencias !== 1 ? "s" : ""}, ${metrics.justificadas} justif.`}
              trend={<Trend pct={pctCambio(metrics.ausentismo, prev.ausentismo)} higherIsBetter={false} />}
            />
            <StatCard
              icon={Wallet}
              label="Particular"
              value={`${metrics.pctParticular.toFixed(0)}%`}
              detail="de las atenciones"
            />
            <StatCard
              icon={Star}
              label="Satisfacción"
              value={satisfaccion.count ? satisfaccion.promedio.toFixed(1) : "—"}
              detail={satisfaccion.count ? `${satisfaccion.count} opinión${satisfaccion.count !== 1 ? "es" : ""}` : "sin opiniones"}
            />
          </div>

          {/* Actividad */}
          <SectionTitle>Actividad</SectionTitle>
          {/* Atenciones por día */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-4 py-4">
            <p className="text-sm font-semibold text-slate-700 mb-3">Atenciones por día</p>
            <div className="flex items-end gap-[3px] h-32">
              {metrics.porDia.map(({ dia, fecha, weekday, count }) => (
                <div
                  key={dia}
                  className="flex-1 flex flex-col items-center gap-1 min-w-0"
                  title={`${format(parseISO(fecha), "EEEE d", { locale: es })}: ${count} atención${count !== 1 ? "es" : ""}`}
                >
                  <div className="w-full flex items-end" style={{ height: "100px" }}>
                    <div
                      className={`w-full rounded-t transition-all ${
                        count === 0 ? "bg-slate-100" : weekday === 0 || weekday === 6 ? "bg-[#001633]/40" : "bg-[#001633]"
                      }`}
                      style={{ height: count === 0 ? "3px" : `${Math.max(8, (count / metrics.maxDia) * 100)}px` }}
                    />
                  </div>
                  <span className={`text-[9px] tabular-nums ${weekday === 0 ? "text-slate-300" : "text-slate-400"}`}>
                    {dia}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-3 items-start">
            {/* Distribución por cobertura */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-4 py-4">
              <p className="text-sm font-semibold text-slate-700 mb-3">Atenciones por cobertura</p>
              {metrics.obraSocialRanking.length === 0 ? (
                <p className="text-xs text-slate-400">Sin atenciones con paciente identificado</p>
              ) : (
                <div className="space-y-2">
                  {metrics.obraSocialRanking.map(({ label, count }) => {
                    const max = metrics.obraSocialRanking[0].count
                    return (
                      <div key={label} className="flex items-center gap-2 text-xs">
                        <span className="w-32 truncate text-slate-600" title={label}>{label}</span>
                        <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${label === "Particular" ? "bg-emerald-500" : "bg-[#001633]"}`}
                            style={{ width: `${(count / max) * 100}%` }}
                          />
                        </div>
                        <span className="w-8 text-right text-slate-500 tabular-nums">{count}</span>
                      </div>
                    )
                  })}
                  {metrics.sinIdentificar > 0 && (
                    <p className="text-[11px] text-slate-400 pt-1">
                      {metrics.sinIdentificar} atención{metrics.sinIdentificar !== 1 ? "es" : ""} sin paciente identificado (turnos viejos sin vínculo a la ficha)
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Ocupación hora × día */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-4 py-4">
              <p className="text-sm font-semibold text-slate-700 mb-3">
                Ocupación por horario <span className="font-normal text-slate-400">(turnos no cancelados)</span>
              </p>
              <div className="grid gap-[3px]" style={{ gridTemplateColumns: "auto repeat(6, 1fr)" }}>
                <div />
                {DIAS_SEMANA.map(({ label }) => (
                  <p key={label} className="text-[10px] text-slate-400 text-center">{label}</p>
                ))}
                {HORAS.map((hora) => (
                  <div key={hora} className="contents">
                    <p className="text-[10px] text-slate-400 pr-1.5 text-right leading-5 tabular-nums">{hora}:00</p>
                    {DIAS_SEMANA.map(({ value: wd }) => {
                      const count = metrics.heatmap.get(`${wd}-${hora}`) ?? 0
                      const alpha = count === 0 ? 0 : 0.15 + 0.75 * (count / metrics.maxHeat)
                      return (
                        <div
                          key={wd}
                          className="h-5 rounded flex items-center justify-center"
                          style={{ backgroundColor: count === 0 ? "rgb(248 250 252)" : `rgba(0, 22, 51, ${alpha})` }}
                          title={`${DIAS_SEMANA.find((d) => d.value === wd)?.label} ${hora}:00 — ${count} turno${count !== 1 ? "s" : ""}`}
                        >
                          {count > 0 && (
                            <span className={`text-[9px] tabular-nums ${alpha > 0.45 ? "text-white" : "text-slate-600"}`}>
                              {count}
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Recaudación (libro diario) */}
      <SectionTitle>Recaudación</SectionTitle>
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-4 py-4">
        {!metrics.hayRecaudacion ? (
          <div className="py-8 text-center">
            <Coins className="h-8 w-8 text-slate-200 mx-auto mb-2" />
            <p className="text-xs text-slate-400">Sin montos cargados en el libro diario de {mesNombre}</p>
            <p className="text-[11px] text-slate-300 mt-0.5">Completá Debe / Haber en el libro diario para ver la recaudación</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
              <MoneyCard icon={Banknote} label="Recaudado" value={formatMoney(metrics.totalHaber)} detail="ingresos (Haber)" tone="green" trend={<Trend pct={pctCambio(metrics.totalHaber, prev.recaudado)} />} />
              <MoneyCard icon={ArrowDownCircle} label="Egresos" value={formatMoney(metrics.totalDebe)} detail="gastos (Debe)" tone="orange" trend={<Trend pct={pctCambio(metrics.totalDebe, prev.egresos)} higherIsBetter={false} />} />
              <MoneyCard icon={Coins} label="Saldo neto" value={formatMoney(metrics.saldoMes)} detail={`en ${mesNombre}`} tone={metrics.saldoMes >= 0 ? "green" : "red"} trend={<Trend pct={pctCambio(metrics.saldoMes, prev.saldo)} />} />
              <MoneyCard icon={Wallet} label="Ticket promedio" value={formatMoney(metrics.ticketPromedio)} detail="por atención" tone="slate" />
            </div>

            {/* Movimiento diario — interactivo (toggle de vista + hover por día) */}
            <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
              <p className="text-xs font-medium text-slate-500">Movimiento diario</p>
              <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-[11px]">
                {VISTAS_RECAUD.map(({ k, label }) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setVistaRecaud(k)}
                    className={`px-2.5 py-1 rounded-md font-medium transition-colors ${vistaRecaud === k ? "bg-white text-[#001633] shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {(() => {
              const d = hoverDia != null ? metrics.recaudPorDia.find((x) => x.dia === hoverDia) : null
              const haber = d ? d.haber : metrics.totalHaber
              const debe = d ? d.debe : metrics.totalDebe
              const saldo = d ? d.saldo : metrics.saldoMes
              return (
                <div className="flex items-baseline justify-between gap-2 mb-2 text-[11px]">
                  <span className="font-medium text-slate-600 truncate">
                    {d ? format(parseISO(d.fecha), "EEEE d 'de' MMM", { locale: es }) : `Total de ${mesNombre}`}
                  </span>
                  <span className="text-slate-400 tabular-nums whitespace-nowrap">
                    Haber <span className="font-medium text-emerald-600">{formatMoney(haber)}</span>
                    {"  ·  "}Debe <span className="font-medium text-orange-600">{formatMoney(debe)}</span>
                    {"  ·  "}Saldo <span className={`font-medium ${saldo >= 0 ? "text-slate-700" : "text-red-600"}`}>{formatMoney(saldo)}</span>
                  </span>
                </div>
              )
            })()}

            <div className="flex items-end gap-[3px] h-28" onMouseLeave={() => setHoverDia(null)}>
              {serieRecaud.puntos.map(({ dia, fecha, val }) => {
                const cero = val === 0
                const altura = cero ? 3 : Math.max(8, (Math.abs(val) / serieRecaud.max) * 90)
                const color = cero
                  ? "bg-slate-100"
                  : vistaRecaud === "saldo"
                  ? val > 0
                    ? "bg-emerald-500"
                    : "bg-red-400"
                  : vistaRecaud === "debe"
                  ? "bg-orange-400"
                  : vistaRecaud === "acum"
                  ? "bg-[#001633]"
                  : "bg-emerald-500"
                const activo = hoverDia === dia
                return (
                  <div
                    key={dia}
                    className="flex-1 flex flex-col items-center gap-1 min-w-0"
                    onMouseEnter={() => setHoverDia(dia)}
                    title={`${format(parseISO(fecha), "EEEE d", { locale: es })}: ${formatMoney(val)}`}
                  >
                    <div className="w-full flex items-end" style={{ height: "90px" }}>
                      <div
                        className={`w-full rounded-t transition-all ${color} ${activo ? "ring-2 ring-[#001633]/30" : ""}`}
                        style={{ height: `${altura}px` }}
                      />
                    </div>
                    <span className={`text-[9px] tabular-nums ${activo ? "text-[#001633] font-semibold" : "text-slate-400"}`}>{dia}</span>
                  </div>
                )
              })}
            </div>
            <p className="text-[11px] text-slate-400 mt-1.5">
              Promedio {formatMoney(metrics.promedioRecaud)} · {metrics.diasConMovimiento} día{metrics.diasConMovimiento !== 1 ? "s" : ""} con caja
              {metrics.mejorDia && <> · mejor día {format(parseISO(metrics.mejorDia.fecha), "d 'de' MMM", { locale: es })} ({formatMoney(metrics.mejorDia.saldo)})</>}
            </p>

            {/* Origen de la recaudación + recaudación por día de semana */}
            <div className="grid lg:grid-cols-2 gap-x-6 gap-y-4 mt-4 pt-4 border-t border-slate-100">
              {fuentesRecaud.fuentes.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-slate-500 mb-2">Origen de la recaudación</p>
                  <div className="space-y-2">
                    {fuentesRecaud.fuentes.map(({ label, monto, color }) => {
                      const total = fuentesRecaud.fuentes.reduce((s, f) => s + f.monto, 0)
                      const pct = total ? (monto / total) * 100 : 0
                      return (
                        <div key={label} className="flex items-center gap-2 text-xs">
                          <span className="w-24 truncate text-slate-600">{label}</span>
                          <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${color}`} style={{ width: `${(monto / fuentesRecaud.max) * 100}%` }} />
                          </div>
                          <span className="w-9 text-right text-slate-400 tabular-nums">{pct.toFixed(0)}%</span>
                          <span className="w-24 text-right text-slate-500 tabular-nums">{formatMoney(monto)}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              <div>
                <p className="text-xs font-medium text-slate-500 mb-2">Recaudación por día de semana</p>
                <div className="space-y-2">
                  {metrics.recaudSemana.map(({ label, haber }) => (
                    <div key={label} className="flex items-center gap-2 text-xs">
                      <span className="w-10 text-slate-600">{label}</span>
                      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-[#001633]" style={{ width: `${(haber / metrics.maxSemana) * 100}%` }} />
                      </div>
                      <span className="w-24 text-right text-slate-500 tabular-nums">{formatMoney(haber)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      <SectionTitle>Pacientes</SectionTitle>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <StatCard
          icon={UserPlus}
          label="Pacientes nuevos"
          value={String(pacientesNuevos)}
          detail={`altas en ${mesNombre}`}
          trend={<Trend pct={pctCambio(pacientesNuevos, pacientesNuevosPrev)} />}
        />
        <StatCard
          icon={Activity}
          label="Pacientes activos"
          value={String(metrics.pacientesActivos)}
          detail="distintos atendidos"
          trend={<Trend pct={pctCambio(metrics.pacientesActivos, prev.activos)} />}
        />
        <StatCard
          icon={CalendarCheck}
          label="Sesiones por paciente"
          value={metrics.sesionesPromedio.toFixed(1)}
          detail="promedio del mes"
        />
      </div>

      {/* Demografía y derivantes (sobre toda la base de pacientes) */}
      <div className="grid lg:grid-cols-2 gap-3 items-start">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-4 py-4">
          <p className="text-sm font-semibold text-slate-700 flex items-center gap-1.5 mb-3">
            <Users className="h-4 w-4 text-[#001633]" />
            Demografía <span className="font-normal text-slate-400">({perfil.total} pacientes)</span>
          </p>
          {/* Sexo */}
          {perfil.conSexo > 0 && (
            <div className="mb-4">
              <div className="flex h-2.5 rounded-full overflow-hidden bg-slate-100">
                <div className="bg-sky-500" style={{ width: `${(perfil.masculino / perfil.conSexo) * 100}%` }} />
                <div className="bg-pink-400" style={{ width: `${(perfil.femenino / perfil.conSexo) * 100}%` }} />
                <div className="bg-slate-300" style={{ width: `${(perfil.otroSexo / perfil.conSexo) * 100}%` }} />
              </div>
              <div className="flex gap-4 mt-2 text-xs text-slate-500">
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-sky-500" /> {perfil.masculino} M</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-pink-400" /> {perfil.femenino} F</span>
                {perfil.otroSexo > 0 && <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-slate-300" /> {perfil.otroSexo} otro</span>}
              </div>
            </div>
          )}
          {/* Edad */}
          <p className="text-xs font-medium text-slate-500 mb-2">Por edad</p>
          <div className="space-y-1.5">
            {perfil.edadBuckets.map(({ rango, count }) => (
              <div key={rango} className="flex items-center gap-2 text-xs">
                <span className="w-12 text-slate-600 tabular-nums">{rango}</span>
                <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-[#001633]" style={{ width: `${(count / perfil.maxEdad) * 100}%` }} />
                </div>
                <span className="w-7 text-right text-slate-500 tabular-nums">{count}</span>
              </div>
            ))}
          </div>
          {perfil.sinEdad > 0 && (
            <p className="text-[11px] text-slate-400 pt-2">{perfil.sinEdad} sin edad cargada</p>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-4 py-4">
          <p className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
            <Stethoscope className="h-4 w-4 text-[#001633]" />
            Derivantes
          </p>
          <p className="text-[11px] text-slate-400 mb-3">Médicos que más pacientes derivaron</p>
          {perfil.derivantesRank.length === 0 ? (
            <p className="text-xs text-slate-400">Sin médico derivante cargado en las fichas</p>
          ) : (
            <div className="space-y-2">
              {perfil.derivantesRank.map(({ nombre, count }) => (
                <div key={nombre} className="flex items-center gap-2 text-xs">
                  <span className="w-36 truncate text-slate-600" title={nombre}>{nombre}</span>
                  <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-[#001633]" style={{ width: `${(count / perfil.derivantesRank[0].count) * 100}%` }} />
                  </div>
                  <span className="w-7 text-right text-slate-500 tabular-nums">{count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-3 items-start">
        {/* Sesiones por agotar (estado actual, independiente del mes) */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-4 py-4">
          <p className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Sesiones por agotar
          </p>
          <p className="text-[11px] text-slate-400 mb-3">Pacientes con 2 sesiones o menos de su autorización — pedirles la nueva orden</p>
          {metrics.porAgotar.length === 0 ? (
            <p className="text-xs text-slate-400">Ningún paciente cerca de agotar sus sesiones</p>
          ) : (
            <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto -mx-4 px-4">
              {metrics.porAgotar.map(({ nombre, telefono, used, authorized, restantes }) => (
                <div key={nombre} className="flex items-center gap-2 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-slate-700 truncate">{nombre}</p>
                    {telefono && <p className="text-[11px] text-slate-400">{telefono}</p>}
                  </div>
                  <span className="text-[11px] text-slate-400 tabular-nums">{used}/{authorized}</span>
                  <span
                    className={`text-[11px] px-2 py-0.5 rounded-full border font-medium whitespace-nowrap ${
                      restantes <= 0
                        ? "bg-red-50 text-red-700 border-red-200"
                        : "bg-amber-50 text-amber-700 border-amber-200"
                    }`}
                  >
                    {restantes <= 0 ? "Agotadas" : `Queda${restantes !== 1 ? "n" : ""} ${restantes}`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Inasistentes del mes */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-4 py-4">
          <p className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
            <UserX className="h-4 w-4 text-red-400" />
            Inasistentes de {mesNombre}
          </p>
          <p className="text-[11px] text-slate-400 mb-3">Pacientes con más faltas — conviene confirmarles el turno el día antes</p>
          {metrics.inasistentes.length === 0 ? (
            <p className="text-xs text-slate-400">Sin ausencias este mes</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {metrics.inasistentes.map(({ nombre, faltas, justificadas }) => (
                <div key={nombre} className="flex items-center gap-2 py-2">
                  <p className="text-sm text-slate-700 truncate flex-1">{nombre}</p>
                  {justificadas > 0 && (
                    <span className="text-[11px] text-slate-400">{justificadas} justif.</span>
                  )}
                  <span className="text-[11px] px-2 py-0.5 rounded-full border font-medium bg-red-50 text-red-700 border-red-200 whitespace-nowrap">
                    {faltas} falta{faltas !== 1 ? "s" : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
