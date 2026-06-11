"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DatePicker } from "@/components/ui/date-picker"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useForm, useFieldArray, useWatch } from "react-hook-form"
import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"
import { ref, get, set } from "firebase/database"
import { db } from "@/lib/firebase"
import { toast } from "sonner"
import { format } from "date-fns-tz"
import { ChevronLeft, ChevronRight, ClipboardCopy, Loader2, Trash2 } from "lucide-react"

type TipoEntrada = "Paciente" | "Gasto" | "Ingreso"

interface EntradaLibroDiario {
  id: string
  tipo: TipoEntrada
  nombreApellido: string
  cobertura: "Particular" | "Obra Social"
  obraSocial: string
  debe: number
  haber: number
}

interface LibroDiarioProps {
  updateTrigger: number
}

const TZ = "America/Argentina/Buenos_Aires"

function toLocalDateKey(date: Date): string {
  return format(date, "yyyy-MM-dd", { timeZone: TZ })
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

const TIPO_STYLES: Record<TipoEntrada, string> = {
  Paciente: "",
  Gasto: "border-orange-300 bg-orange-50",
  Ingreso: "border-green-300 bg-green-50",
}

const TIPO_PLACEHOLDER: Record<TipoEntrada, string> = {
  Paciente: "Nombre y Apellido",
  Gasto: "Descripción del gasto",
  Ingreso: "Motivo del ingreso",
}

export function LibroDiario({ updateTrigger }: LibroDiarioProps) {
  const [fecha, setFecha] = useState<Date>(new Date())
  const [totalDebe, setTotalDebe] = useState(0)
  const [totalHaber, setTotalHaber] = useState(0)
  const [isSaving, setIsSaving] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isCopying, setIsCopying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastSavedData, setLastSavedData] = useState("[]")
  const [deleteIndex, setDeleteIndex] = useState<number | null>(null)
  const [confirmCopyOpen, setConfirmCopyOpen] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingSave = useRef<{ dateKey: string; entradas: EntradaLibroDiario[] } | null>(null)

  const isToday = toLocalDateKey(fecha) === toLocalDateKey(new Date())

  const { register, control, setValue } = useForm<{ entradas: EntradaLibroDiario[] }>({
    defaultValues: { entradas: [] },
    mode: "onChange",
  })

  const { fields, append, remove: removeField } = useFieldArray({
    control,
    name: "entradas",
  })

  const watchEntradas = useWatch({ control, name: "entradas" })

  const saveEntries = useCallback(
    async (entries: EntradaLibroDiario[], dateKey: string) => {
      setIsSaving(true)
      setError(null)
      try {
        // Un campo numérico vacío llega como NaN (valueAsNumber) y Firebase rechaza NaN
        const sanitized = entries.map((e) => ({
          ...e,
          debe: Number(e?.debe) || 0,
          haber: Number(e?.haber) || 0,
        }))
        const newTotalHaber = sanitized.reduce((sum, e) => sum + e.haber, 0)
        const newTotalDebe = sanitized.reduce((sum, e) => sum + e.debe, 0)

        setLastSavedData(JSON.stringify(entries))

        await set(ref(db, `libroDiario/${dateKey}`), {
          fecha: dateKey,
          entradas: sanitized,
          totalHaber: newTotalHaber,
          totalDebe: newTotalDebe,
        })
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Error desconocido'
        setError(`Error al guardar: ${msg}`)
        toast.error(`Error al guardar: ${msg}`)
      } finally {
        setIsSaving(false)
      }
    },
    [],
  )

  const flushPendingSave = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    if (pendingSave.current) {
      const { dateKey, entradas } = pendingSave.current
      pendingSave.current = null
      saveEntries(entradas, dateKey)
    }
  }, [saveEntries])

  // Totales en tiempo real
  useEffect(() => {
    if (Array.isArray(watchEntradas)) {
      setTotalHaber(watchEntradas.reduce((sum, e) => sum + (Number(e?.haber) || 0), 0))
      setTotalDebe(watchEntradas.reduce((sum, e) => sum + (Number(e?.debe) || 0), 0))
    } else {
      setTotalHaber(0)
      setTotalDebe(0)
    }
  }, [watchEntradas])

  // Auto-save con debounce de 800ms
  useEffect(() => {
    if (!watchEntradas || !Array.isArray(watchEntradas)) return

    const dateKey = toLocalDateKey(fecha)

    // Cambió la fecha con una edición pendiente: guardarla ya en SU fecha,
    // antes de que el fetch reemplace el formulario
    if (pendingSave.current && pendingSave.current.dateKey !== dateKey) {
      flushPendingSave()
      return
    }

    const currentData = JSON.stringify(watchEntradas)
    if (currentData === lastSavedData) return

    pendingSave.current = { dateKey, entradas: watchEntradas as EntradaLibroDiario[] }
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null
      const pending = pendingSave.current
      pendingSave.current = null
      if (pending) saveEntries(pending.entradas, pending.dateKey)
    }, 800)
  }, [watchEntradas, lastSavedData, fecha, saveEntries, flushPendingSave])

  // Al desmontar (cambio de pestaña), no perder la edición pendiente
  useEffect(() => {
    return () => flushPendingSave()
  }, [flushPendingSave])

  const fetchEntriesForDate = useCallback(
    async (date: Date) => {
      setIsLoading(true)
      setError(null)
      // El fetch reemplaza el formulario: descartar cualquier guardado pendiente
      if (saveTimer.current) {
        clearTimeout(saveTimer.current)
        saveTimer.current = null
      }
      pendingSave.current = null
      try {
        const snapshot = await get(ref(db, `libroDiario/${toLocalDateKey(date)}`))

        if (snapshot.exists()) {
          const data = snapshot.val()
          const normalized = (data.entradas || []).map((e: EntradaLibroDiario) => ({
            ...e,
            id: e.id || crypto.randomUUID(),
            tipo: (e.tipo as TipoEntrada) ?? "Paciente",
          }))
          setValue("entradas", normalized)
          setTotalHaber(data.totalHaber || 0)
          setTotalDebe(data.totalDebe || 0)
          setLastSavedData(JSON.stringify(normalized))
        } else {
          setValue("entradas", [])
          setTotalHaber(0)
          setTotalDebe(0)
          setLastSavedData("[]")
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Error desconocido'
        setError(`Error al cargar: ${msg}`)
        toast.error(`Error: ${msg}`)
      } finally {
        setIsLoading(false)
      }
    },
    [setValue],
  )

  useEffect(() => {
    fetchEntriesForDate(fecha)
  }, [fecha, fetchEntriesForDate])

  useEffect(() => {
    if (updateTrigger > 0) {
      fetchEntriesForDate(fecha)
    }
  }, [updateTrigger, fecha, fetchEntriesForDate])

  const agregarFila = (tipo: TipoEntrada = "Paciente") => {
    append({
      id: crypto.randomUUID(),
      tipo,
      nombreApellido: "",
      cobertura: "Particular",
      obraSocial: "-",
      debe: 0,
      haber: 0,
    })
  }

  const confirmDelete = () => {
    if (deleteIndex !== null) {
      removeField(deleteIndex)
      setDeleteIndex(null)
      toast.success('Entrada eliminada')
    }
  }

  const doCopyPrevDay = async () => {
    setIsCopying(true)
    try {
      const prevDate = addDays(fecha, -1)
      const snapshot = await get(ref(db, `libroDiario/${toLocalDateKey(prevDate)}`))

      if (!snapshot.exists() || !snapshot.val().entradas?.length) {
        toast.error('No hay entradas el día anterior')
        return
      }

      const prevEntradas: EntradaLibroDiario[] = (snapshot.val().entradas || []).map(
        (e: EntradaLibroDiario) => ({
          ...e,
          id: crypto.randomUUID(),
          tipo: e.tipo ?? "Paciente",
          debe: 0,
          haber: 0,
        })
      )

      prevEntradas.forEach(e => append(e))
      toast.success(`${prevEntradas.length} entrada${prevEntradas.length !== 1 ? 's' : ''} copiada${prevEntradas.length !== 1 ? 's' : ''} del día anterior`)
    } catch {
      toast.error('Error al copiar el día anterior')
    } finally {
      setIsCopying(false)
    }
  }

  const copyPrevDay = () => {
    if (fields.length > 0) {
      setConfirmCopyOpen(true)
    } else {
      doCopyPrevDay()
    }
  }

  const exportarPDF = () => {
    if (!watchEntradas?.length) {
      toast.error('No hay datos para exportar')
      return
    }
    try {
      const doc = new jsPDF()
      const dateStr = format(fecha, "dd/MM/yyyy", { timeZone: TZ })

      doc.setFontSize(14)
      doc.text(`Libro Diario — ${dateStr}`, 14, 16)

      const saldo = totalHaber - totalDebe

      autoTable(doc, {
        startY: 24,
        head: [["N°", "Tipo", "Nombre / Descripción", "Cobertura", "Obra Social", "Debe", "Haber"]],
        body: (watchEntradas as EntradaLibroDiario[]).map((e, i) => {
          const tipo = e.tipo ?? "Paciente"
          const esPaciente = tipo === "Paciente"
          return [
            i + 1,
            tipo,
            e.nombreApellido,
            esPaciente ? e.cobertura : "—",
            esPaciente ? e.obraSocial : "—",
            `$${(Number(e.debe) || 0).toFixed(2)}`,
            `$${(Number(e.haber) || 0).toFixed(2)}`,
          ]
        }),
        foot: [
          ["", "", "", "", "", "Total Haber", `$${totalHaber.toFixed(2)}`],
          ["", "", "", "", "", "Total Debe", `$${totalDebe.toFixed(2)}`],
          [{ content: `Saldo de caja: $${saldo.toFixed(2)}`, colSpan: 7, styles: { halign: "right" as const, fontStyle: "bold" as const } }],
        ],
        footStyles: { fillColor: [248, 250, 252] as [number, number, number], textColor: [30, 30, 30] as [number, number, number] },
      })

      doc.save(`${toLocalDateKey(fecha)}_LibroDiario.pdf`)
      toast.success('PDF exportado correctamente')
    } catch (error) {
      toast.error(`Error al exportar: ${error instanceof Error ? error.message : 'Error'}`)
    }
  }

  const saldo = totalHaber - totalDebe

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl sm:text-3xl font-semibold text-[#001633]">Libro Diario</h2>
          {fields.length > 0 && (
            <span className="text-sm text-gray-500 font-normal">
              {fields.length} entrada{fields.length !== 1 ? 's' : ''}
            </span>
          )}
          {isSaving && (
            <span className="flex items-center gap-1 text-xs text-gray-400">
              <Loader2 className="h-3 w-3 animate-spin" />
              Guardando...
            </span>
          )}
        </div>

        {/* Navegación de fecha */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-9 w-9 p-0"
            onClick={() => setFecha(addDays(fecha, -1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <DatePicker date={fecha} setDate={setFecha} />
          <Button
            variant="outline"
            size="sm"
            className="h-9 w-9 p-0"
            onClick={() => setFecha(addDays(fecha, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          {!isToday && (
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-9 border-[#001633] text-[#001633] hover:bg-[#001633] hover:text-white transition-colors"
              onClick={() => setFecha(new Date())}
            >
              Hoy
            </Button>
          )}
        </div>
      </div>

      {isLoading && <div className="text-center py-4 text-gray-600">Cargando...</div>}
      {error && (
        <div className="text-red-800 bg-red-50 border border-red-200 rounded-lg p-3 text-sm">
          {error}
        </div>
      )}

      {/* Mobile: cards */}
      <div className="sm:hidden space-y-2">
        {!fields.length ? (
          <div className="text-center py-8 text-gray-500 bg-white border border-gray-200 rounded-lg text-sm">
            No hay entradas para este día.
          </div>
        ) : (
          fields.map((field, index) => {
            const tipo: TipoEntrada = (watchEntradas?.[index]?.tipo as TipoEntrada) ?? "Paciente"
            const esPaciente = tipo === "Paciente"
            const esGasto = tipo === "Gasto"
            const esIngreso = tipo === "Ingreso"
            const isIncomplete = (Number(watchEntradas?.[index]?.debe) || 0) === 0 && (Number(watchEntradas?.[index]?.haber) || 0) === 0
            const obraSocialVacia = esPaciente && watchEntradas?.[index]?.cobertura === "Obra Social" && !watchEntradas?.[index]?.obraSocial?.trim()
            const cardBg = isIncomplete
              ? "border-amber-200 bg-amber-50/40"
              : tipo === "Gasto" ? "border-orange-200 bg-orange-50"
              : tipo === "Ingreso" ? "border-green-200 bg-green-50"
              : "border-gray-200 bg-white"
            return (
              <div key={field.id} className={`border rounded-lg p-3 space-y-2.5 ${cardBg}`}>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 font-mono w-5 shrink-0">{index + 1}</span>
                  <Select
                    value={tipo}
                    onValueChange={(value) => {
                      setValue(`entradas.${index}.tipo`, value as TipoEntrada)
                      if (value === "Gasto") { setValue(`entradas.${index}.cobertura`, "Particular"); setValue(`entradas.${index}.obraSocial`, "-"); setValue(`entradas.${index}.haber`, 0) }
                      if (value === "Ingreso") { setValue(`entradas.${index}.cobertura`, "Particular"); setValue(`entradas.${index}.obraSocial`, "-"); setValue(`entradas.${index}.debe`, 0) }
                    }}
                  >
                    <SelectTrigger className={`border-gray-300 text-xs h-8 flex-1 ${TIPO_STYLES[tipo]}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Paciente">Paciente</SelectItem>
                      <SelectItem value="Gasto">Gasto</SelectItem>
                      <SelectItem value="Ingreso">Ingreso</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0 hover:bg-red-600 hover:text-white transition-colors shrink-0" onClick={() => setDeleteIndex(index)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <Input {...register(`entradas.${index}.nombreApellido`)} placeholder={TIPO_PLACEHOLDER[tipo]} className="border-gray-300 focus:border-[#001633] h-8 text-sm" />
                {esPaciente && (
                  <div className="flex gap-2">
                    <Select
                      value={watchEntradas?.[index]?.cobertura ?? "Particular"}
                      onValueChange={(value) => {
                        setValue(`entradas.${index}.cobertura`, value as "Particular" | "Obra Social")
                        if (value === "Particular") setValue(`entradas.${index}.obraSocial`, "-")
                      }}
                    >
                      <SelectTrigger className="border-gray-300 h-8 text-sm w-36 shrink-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Particular">Particular</SelectItem>
                        <SelectItem value="Obra Social">Obra Social</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      {...register(`entradas.${index}.obraSocial`)}
                      disabled={watchEntradas?.[index]?.cobertura === "Particular"}
                      placeholder="Obra social..."
                      className={`border-gray-300 focus:border-[#001633] h-8 text-sm disabled:bg-gray-100 disabled:text-gray-400 ${obraSocialVacia ? "border-red-400 bg-red-50" : ""}`}
                    />
                  </div>
                )}
                <div className="flex gap-3">
                  <div className="flex-1 space-y-1">
                    <label className="text-xs text-gray-500">Debe</label>
                    <Input {...register(`entradas.${index}.debe`, { valueAsNumber: true })} type="number" step="0.01" min={0} disabled={esIngreso} onWheel={(e) => (e.target as HTMLInputElement).blur()} className="border-gray-300 focus:border-[#001633] h-8 disabled:bg-gray-100 disabled:text-gray-400" />
                  </div>
                  <div className="flex-1 space-y-1">
                    <label className="text-xs text-gray-500">Haber</label>
                    <Input {...register(`entradas.${index}.haber`, { valueAsNumber: true })} type="number" step="0.01" min={0} disabled={esGasto} onWheel={(e) => (e.target as HTMLInputElement).blur()} className="border-gray-300 focus:border-[#001633] h-8 disabled:bg-gray-100 disabled:text-gray-400" />
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Desktop: tabla */}
      <div className="hidden sm:block overflow-x-auto">
        <div className="border border-[#001633] rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-[#001633] hover:bg-[#001633]">
                <TableHead className="text-white font-semibold w-10 text-center">N°</TableHead>
                <TableHead className="text-white font-semibold w-28">Tipo</TableHead>
                <TableHead className="text-white font-semibold">Nombre / Descripción</TableHead>
                <TableHead className="text-white font-semibold">Cobertura</TableHead>
                <TableHead className="text-white font-semibold">Obra Social</TableHead>
                <TableHead className="text-white font-semibold">Debe</TableHead>
                <TableHead className="text-white font-semibold">Haber</TableHead>
                <TableHead className="text-white font-semibold w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!fields.length ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-gray-500">
                    No hay entradas para este día.
                  </TableCell>
                </TableRow>
              ) : (
                fields.map((field, index) => {
                  const tipo: TipoEntrada = (watchEntradas?.[index]?.tipo as TipoEntrada) ?? "Paciente"
                  const esPaciente = tipo === "Paciente"
                  const esGasto = tipo === "Gasto"
                  const esIngreso = tipo === "Ingreso"

                  const isIncomplete = (Number(watchEntradas?.[index]?.debe) || 0) === 0 && (Number(watchEntradas?.[index]?.haber) || 0) === 0
                  const obraSocialVacia = esPaciente && watchEntradas?.[index]?.cobertura === "Obra Social" && !watchEntradas?.[index]?.obraSocial?.trim()
                  return (
                    <TableRow key={field.id} className={isIncomplete ? "bg-amber-50/60" : index % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                      <TableCell className="text-center text-sm">{index + 1}</TableCell>
                      <TableCell>
                        <Select
                          value={tipo}
                          onValueChange={(value) => {
                            setValue(`entradas.${index}.tipo`, value as TipoEntrada)
                            if (value === "Gasto") {
                              setValue(`entradas.${index}.cobertura`, "Particular")
                              setValue(`entradas.${index}.obraSocial`, "-")
                              setValue(`entradas.${index}.haber`, 0)
                            }
                            if (value === "Ingreso") {
                              setValue(`entradas.${index}.cobertura`, "Particular")
                              setValue(`entradas.${index}.obraSocial`, "-")
                              setValue(`entradas.${index}.debe`, 0)
                            }
                          }}
                        >
                          <SelectTrigger className={`border-gray-300 text-xs ${TIPO_STYLES[tipo]}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Paciente">Paciente</SelectItem>
                            <SelectItem value="Gasto">Gasto</SelectItem>
                            <SelectItem value="Ingreso">Ingreso</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Input
                          {...register(`entradas.${index}.nombreApellido`)}
                          placeholder={TIPO_PLACEHOLDER[tipo]}
                          className="border-gray-300 focus:border-[#001633]"
                        />
                      </TableCell>
                      <TableCell>
                        {esPaciente ? (
                          <Select
                            value={watchEntradas?.[index]?.cobertura ?? "Particular"}
                            onValueChange={(value) => {
                              setValue(`entradas.${index}.cobertura`, value as "Particular" | "Obra Social")
                              if (value === "Particular") {
                                setValue(`entradas.${index}.obraSocial`, "-")
                              }
                            }}
                          >
                            <SelectTrigger className="border-gray-300 focus:border-[#001633]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Particular">Particular</SelectItem>
                              <SelectItem value="Obra Social">Obra Social</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <span className="text-gray-400 text-sm px-2">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {esPaciente ? (
                          <Input
                            {...register(`entradas.${index}.obraSocial`)}
                            disabled={watchEntradas?.[index]?.cobertura === "Particular"}
                            className={`border-gray-300 focus:border-[#001633] disabled:bg-gray-100 disabled:text-gray-400 ${obraSocialVacia ? "border-red-400 bg-red-50" : ""}`}
                          />
                        ) : (
                          <span className="text-gray-400 text-sm px-2">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Input
                          {...register(`entradas.${index}.debe`, { valueAsNumber: true })}
                          type="number"
                          step="0.01"
                          min={0}
                          disabled={esIngreso}
                          onWheel={(e) => (e.target as HTMLInputElement).blur()}
                          className="border-gray-300 focus:border-[#001633] disabled:bg-gray-100 disabled:text-gray-400"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          {...register(`entradas.${index}.haber`, { valueAsNumber: true })}
                          type="number"
                          step="0.01"
                          min={0}
                          disabled={esGasto}
                          onWheel={(e) => (e.target as HTMLInputElement).blur()}
                          className="border-gray-300 focus:border-[#001633] disabled:bg-gray-100 disabled:text-gray-400"
                        />
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 hover:bg-red-600 hover:text-white transition-colors"
                          onClick={() => setDeleteIndex(index)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Acciones y saldo */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex gap-2 flex-wrap">
          <Button
            type="button"
            onClick={() => agregarFila("Paciente")}
            className="bg-[#001633] hover:bg-[#002966] transition-colors"
          >
            + Paciente
          </Button>
          <Button
            type="button"
            onClick={() => agregarFila("Gasto")}
            variant="outline"
            className="border-orange-400 text-orange-600 hover:bg-orange-50 transition-colors"
          >
            + Gasto
          </Button>
          <Button
            type="button"
            onClick={() => agregarFila("Ingreso")}
            variant="outline"
            className="border-green-500 text-green-700 hover:bg-green-50 transition-colors"
          >
            + Ingreso
          </Button>
          <Button
            type="button"
            onClick={copyPrevDay}
            variant="outline"
            disabled={isCopying}
            className="border-gray-400 text-gray-600 hover:bg-gray-50 transition-colors flex items-center gap-1"
          >
            {isCopying
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <ClipboardCopy className="h-3 w-3" />
            }
            Copiar día anterior
          </Button>
        </div>

        <div className="flex items-stretch rounded-xl border border-gray-200 overflow-hidden bg-gray-50">
          <div className="flex flex-col items-center justify-center px-4 py-2.5">
            <span className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">Haber</span>
            <span className="font-semibold text-green-600 text-lg leading-tight">${totalHaber.toFixed(2)}</span>
          </div>
          <div className="border-l border-gray-200" />
          <div className="flex flex-col items-center justify-center px-4 py-2.5">
            <span className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">Debe</span>
            <span className="font-semibold text-orange-600 text-lg leading-tight">${totalDebe.toFixed(2)}</span>
          </div>
          <div className="border-l border-gray-200" />
          <div className="flex flex-col items-center justify-center px-4 py-2.5 bg-white">
            <span className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">Saldo</span>
            <span className={`font-bold text-xl leading-tight ${saldo >= 0 ? "text-green-700" : "text-red-600"}`}>
              ${saldo.toFixed(2)}
            </span>
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <Button
          type="button"
          onClick={exportarPDF}
          variant="outline"
          className="border-[#001633] text-[#001633] hover:bg-[#001633] hover:text-white transition-colors"
        >
          Exportar PDF
        </Button>
      </div>

      {/* Confirmación copiar día anterior con entradas existentes */}
      <AlertDialog open={confirmCopyOpen} onOpenChange={setConfirmCopyOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Agregar entradas del día anterior?</AlertDialogTitle>
            <AlertDialogDescription>
              Este día ya tiene {fields.length} entrada{fields.length !== 1 ? "s" : ""}. Las entradas del día anterior se van a agregar al final de la lista actual.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmCopyOpen(false); doCopyPrevDay() }}>
              Agregar igual
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmación de eliminación */}
      <AlertDialog open={deleteIndex !== null} onOpenChange={(open) => !open && setDeleteIndex(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar entrada?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteIndex !== null && watchEntradas?.[deleteIndex]?.nombreApellido
                ? `Se eliminará la entrada de "${watchEntradas[deleteIndex].nombreApellido}". Esta acción no se puede deshacer.`
                : 'Esta acción no se puede deshacer.'
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
