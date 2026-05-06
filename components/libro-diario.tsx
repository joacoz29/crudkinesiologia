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
  newEntry?: { nombreApellido: string } | null
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

export function LibroDiario({ newEntry, updateTrigger }: LibroDiarioProps) {
  const [fecha, setFecha] = useState<Date>(new Date())
  const [totalDebe, setTotalDebe] = useState(0)
  const [totalHaber, setTotalHaber] = useState(0)
  const [entryAdded, setEntryAdded] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isCopying, setIsCopying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastSavedData, setLastSavedData] = useState("")
  const [deleteIndex, setDeleteIndex] = useState<number | null>(null)
  const skipNextSave = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

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
    async (entries: EntradaLibroDiario[]) => {
      setIsSaving(true)
      setError(null)
      try {
        const dateKey = toLocalDateKey(fecha)
        const newTotalHaber = entries.reduce((sum, e) => sum + (Number(e?.haber) || 0), 0)
        const newTotalDebe = entries.reduce((sum, e) => sum + (Number(e?.debe) || 0), 0)

        await set(ref(db, `libroDiario/${dateKey}`), {
          fecha: fecha.toISOString(),
          entradas: entries,
          totalHaber: newTotalHaber,
          totalDebe: newTotalDebe,
        })

        setLastSavedData(JSON.stringify(entries))
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Error desconocido'
        setError(`Error al guardar: ${msg}`)
        toast.error(`Error al guardar: ${msg}`)
      } finally {
        setIsSaving(false)
      }
    },
    [fecha],
  )

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
    if (skipNextSave.current) {
      skipNextSave.current = false
      return
    }
    if (!watchEntradas || !Array.isArray(watchEntradas)) return

    const currentData = JSON.stringify(watchEntradas)
    if (currentData === lastSavedData) return

    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveEntries(watchEntradas as EntradaLibroDiario[])
    }, 800)

    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [watchEntradas, lastSavedData, saveEntries])

  // Agregar entrada desde modal de paciente
  useEffect(() => {
    if (newEntry?.nombreApellido && !entryAdded) {
      const exists = fields.some(f => f.nombreApellido === newEntry.nombreApellido)
      if (!exists) {
        append({
          id: (fields.length + 1).toString(),
          tipo: "Paciente",
          nombreApellido: newEntry.nombreApellido,
          cobertura: "Particular",
          obraSocial: "-",
          debe: 0,
          haber: 0,
        })
        setEntryAdded(true)
      }
    }
  }, [newEntry, append, fields, entryAdded])

  useEffect(() => {
    return () => { setEntryAdded(false) }
  }, [])

  const fetchEntriesForDate = useCallback(
    async (date: Date) => {
      setIsLoading(true)
      setError(null)
      try {
        const snapshot = await get(ref(db, `libroDiario/${toLocalDateKey(date)}`))

        if (snapshot.exists()) {
          const data = snapshot.val()
          const normalized = (data.entradas || []).map((e: EntradaLibroDiario) => ({
            ...e,
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
          setLastSavedData("")
        }
        skipNextSave.current = true
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
      id: (fields.length + 1).toString(),
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

  const copyPrevDay = async () => {
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
          tipo: e.tipo ?? "Paciente",
          debe: 0,
          haber: 0,
        })
      )

      prevEntradas.forEach(e => append(e))
      toast.success(`${prevEntradas.length} entrada${prevEntradas.length !== 1 ? 's' : ''} copiada${prevEntradas.length !== 1 ? 's' : ''} del día anterior`)
    } catch (error) {
      toast.error('Error al copiar el día anterior')
    } finally {
      setIsCopying(false)
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
        foot: [[{
          content: `Saldo de caja: $${saldo.toFixed(2)}`,
          colSpan: 7,
          styles: { halign: "right", fontStyle: "bold" },
        }]],
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

      {/* Tabla */}
      <div className="overflow-x-auto">
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

                  return (
                    <TableRow key={field.id} className={index % 2 === 0 ? "bg-white" : "bg-gray-50"}>
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
                            className="border-gray-300 focus:border-[#001633] disabled:bg-gray-100 disabled:text-gray-400"
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

        <div className="text-center">
          <div className="text-gray-500 text-xs uppercase tracking-wide">Saldo de caja</div>
          <div className={`font-bold text-2xl ${saldo >= 0 ? "text-green-600" : "text-red-600"}`}>
            ${saldo.toFixed(2)}
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
