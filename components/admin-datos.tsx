"use client"

import { useMemo } from "react"
import { format, parseISO, startOfMonth, endOfMonth, getDay, getDaysInMonth } from "date-fns"
import { es } from "date-fns/locale"
import { CalendarCheck, TrendingUp, UserX, Wallet, Inbox, AlertTriangle, Banknote, ArrowDownCircle, Coins } from "lucide-react"
import { fetchTurnosPorRango, fetchLibroDiarioPorRango, getSessionStats } from "@/lib/helpers"
import { usePatients } from "@/lib/patients-store"
import { useCachedMonth } from "@/lib/monthly-cache"
import { Patient, Turno } from "@/types"

// Formato de moneda argentino: $1.234,56
function formatMoney(n: number): string {
  return `$${n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
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
}: {
  icon: typeof CalendarCheck
  label: string
  value: string
  detail: string
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 px-4 py-3 shadow-sm flex items-center gap-3">
      <div className="h-9 w-9 rounded-xl bg-[#001633]/5 flex items-center justify-center shrink-0">
        <Icon className="h-5 w-5 text-[#001633]" />
      </div>
      <div className="min-w-0">
        <p className="text-xl font-semibold text-slate-800 leading-tight tabular-nums">{value}</p>
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
}: {
  icon: typeof CalendarCheck
  label: string
  value: string
  detail: string
  tone: keyof typeof MONEY_TONES
}) {
  const t = MONEY_TONES[tone]
  return (
    <div className="bg-white rounded-2xl border border-slate-200 px-4 py-3 shadow-sm flex items-center gap-3">
      <div className={`h-9 w-9 rounded-xl ${t.bg} flex items-center justify-center shrink-0`}>
        <Icon className={`h-5 w-5 ${t.icon}`} />
      </div>
      <div className="min-w-0">
        <p className={`text-lg font-semibold leading-tight tabular-nums truncate ${t.value}`}>{value}</p>
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

  const mesKey = format(currentMonth, "yyyy-MM")
  const esMesActual = mesKey === format(new Date(), "yyyy-MM")

  // Turnos del mes cacheados por sesión (revalida solo el mes actual). Así
  // togglear de vista no re-baja los turnos de meses pasados.
  const { data: turnosPorDia, isLoading: isLoadingTurnos } = useCachedMonth<Record<string, Turno[]>>(
    `turnos-datos/${mesKey}`,
    () =>
      fetchTurnosPorRango(
        format(startOfMonth(currentMonth), "yyyy-MM-dd"),
        format(endOfMonth(currentMonth), "yyyy-MM-dd"),
      ),
    { revalidate: esMesActual, fallback: {} },
  )

  // Recaudación del mes desde el libro diario (haber/debe por día), cacheada por sesión
  const { data: libroPorDia, isLoading: isLoadingLibro } = useCachedMonth<Record<string, { haber: number; debe: number }>>(
    `libro-datos/${mesKey}`,
    () =>
      fetchLibroDiarioPorRango(
        format(startOfMonth(currentMonth), "yyyy-MM-dd"),
        format(endOfMonth(currentMonth), "yyyy-MM-dd"),
      ),
    { revalidate: esMesActual, fallback: {} },
  )

  const isLoading = isLoadingTurnos || isLoadingPatients || isLoadingLibro

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
      const l = libroPorDia[fecha]
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

    return {
      atenciones: asistidos.length,
      ausencias: ausentes.length,
      justificadas,
      ausentismo,
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
      sinTurnos: todos.length === 0,
    }
  }, [turnosPorDia, libroPorDia, patients, currentMonth])

  const mesNombre = format(currentMonth, "MMMM", { locale: es })

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
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
      {metrics.sinTurnos ? (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm px-4 py-16 text-center">
          <Inbox className="h-8 w-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-400">Sin turnos registrados en {mesNombre}</p>
        </div>
      ) : (
        <>
          {/* Tarjetas resumen */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard
              icon={CalendarCheck}
              label="Atenciones"
              value={String(metrics.atenciones)}
              detail={`en ${mesNombre}`}
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
            />
            <StatCard
              icon={Wallet}
              label="Particular"
              value={`${metrics.pctParticular.toFixed(0)}%`}
              detail="de las atenciones"
            />
          </div>

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
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-4 py-4">
        <div className="flex items-center justify-between gap-2 mb-3">
          <p className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
            <Coins className="h-4 w-4 text-emerald-500" />
            Recaudación de {mesNombre}
          </p>
          {metrics.mejorDia && (
            <p className="text-[11px] text-slate-400 truncate">
              Mejor día: {format(parseISO(metrics.mejorDia.fecha), "d 'de' MMM", { locale: es })} · {formatMoney(metrics.mejorDia.saldo)}
            </p>
          )}
        </div>

        {!metrics.hayRecaudacion ? (
          <div className="py-8 text-center">
            <Coins className="h-8 w-8 text-slate-200 mx-auto mb-2" />
            <p className="text-xs text-slate-400">Sin montos cargados en el libro diario de {mesNombre}</p>
            <p className="text-[11px] text-slate-300 mt-0.5">Completá Debe / Haber en el libro diario para ver la recaudación</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
              <MoneyCard icon={Banknote} label="Recaudado" value={formatMoney(metrics.totalHaber)} detail="ingresos (Haber)" tone="green" />
              <MoneyCard icon={ArrowDownCircle} label="Egresos" value={formatMoney(metrics.totalDebe)} detail="gastos (Debe)" tone="orange" />
              <MoneyCard icon={Coins} label="Saldo neto" value={formatMoney(metrics.saldoMes)} detail={`en ${mesNombre}`} tone={metrics.saldoMes >= 0 ? "green" : "red"} />
              <MoneyCard icon={TrendingUp} label="Promedio diario" value={formatMoney(metrics.promedioRecaud)} detail={`${metrics.diasConMovimiento} día${metrics.diasConMovimiento !== 1 ? "s" : ""} con caja`} tone="slate" />
            </div>

            <p className="text-xs font-medium text-slate-500 mb-2">Saldo por día</p>
            <div className="flex items-end gap-[3px] h-28">
              {metrics.recaudPorDia.map(({ dia, fecha, saldo }) => {
                const cero = saldo === 0
                const altura = cero ? 3 : Math.max(8, (Math.abs(saldo) / metrics.maxSaldoAbs) * 90)
                return (
                  <div
                    key={dia}
                    className="flex-1 flex flex-col items-center gap-1 min-w-0"
                    title={`${format(parseISO(fecha), "EEEE d", { locale: es })}: ${formatMoney(saldo)}`}
                  >
                    <div className="w-full flex items-end" style={{ height: "90px" }}>
                      <div
                        className={`w-full rounded-t transition-all ${cero ? "bg-slate-100" : saldo > 0 ? "bg-emerald-500" : "bg-red-400"}`}
                        style={{ height: `${altura}px` }}
                      />
                    </div>
                    <span className="text-[9px] tabular-nums text-slate-400">{dia}</span>
                  </div>
                )
              })}
            </div>
          </>
        )}
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
