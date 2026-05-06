"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DatePicker } from "@/components/ui/date-picker"
import { useForm, useFieldArray } from "react-hook-form"
import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"
import { ref, get, set } from "firebase/database"
import { db } from "@/lib/firebase"
import { toast } from "sonner"
import { format } from "date-fns-tz"
import { Loader2, Trash2 } from "lucide-react"

interface EntradaLibroDiario {
  id: string
  tipo: "Paciente" | "Gasto"
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

export function LibroDiario({ newEntry, updateTrigger }: LibroDiarioProps) {
  const [fecha, setFecha] = useState<Date>(new Date())
  const [totalDebe, setTotalDebe] = useState(0)
  const [totalHaber, setTotalHaber] = useState(0)
  const [entryAdded, setEntryAdded] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastSavedData, setLastSavedData] = useState("")
  const skipNextSave = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { register, control, watch, setValue } = useForm<{ entradas: EntradaLibroDiario[] }>({
    defaultValues: { entradas: [] },
  })

  const { fields, append, remove: removeField } = useFieldArray({
    control,
    name: "entradas",
  })

  const watchEntradas = watch("entradas")

  const saveEntries = useCallback(
    async (entries: EntradaLibroDiario[]) => {
      setIsSaving(true)
      setError(null)
      try {
        const dateKey = toLocalDateKey(fecha)
        const newTotalHaber = entries.reduce((sum, e) => sum + (e?.haber || 0), 0)
        const newTotalDebe = entries.reduce((sum, e) => sum + (e?.debe || 0), 0)

        await set(ref(db, `libroDiario/${dateKey}`), {
          fecha: fecha.toISOString(),
          entradas: entries,
          totalHaber: newTotalHaber,
          totalDebe: newTotalDebe,
        })

        setTotalHaber(newTotalHaber)
        setTotalDebe(newTotalDebe)
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

  // Auto-save con debounce de 1.5s para no escribir en Firebase en cada tecla
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
      saveEntries(watchEntradas)
    }, 1500)

    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [watchEntradas, lastSavedData, saveEntries])

  // Totales reactivos
  useEffect(() => {
    if (Array.isArray(watchEntradas)) {
      setTotalHaber(watchEntradas.reduce((sum, e) => sum + (e?.haber || 0), 0))
      setTotalDebe(watchEntradas.reduce((sum, e) => sum + (e?.debe || 0), 0))
    } else {
      setTotalHaber(0)
      setTotalDebe(0)
    }
  }, [watchEntradas])

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
            tipo: e.tipo ?? "Paciente",
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

  // Refetch cuando se actualiza un paciente desde la tabla
  useEffect(() => {
    if (updateTrigger > 0) {
      fetchEntriesForDate(fecha)
    }
  }, [updateTrigger, fecha, fetchEntriesForDate])

  const agregarFila = (tipo: "Paciente" | "Gasto" = "Paciente") => {
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

  const handleRemove = (index: number) => {
    removeField(index)
    // El auto-save detecta el cambio y actualiza Firebase
    toast.success('Entrada eliminada')
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

      autoTable(doc, {
        startY: 24,
        head: [["N°", "Tipo", "Nombre / Descripción", "Cobertura", "Obra Social", "Debe", "Haber"]],
        body: watchEntradas.map((e, i) => [
          i + 1,
          e.tipo ?? "Paciente",
          e.nombreApellido,
          e.tipo === "Gasto" ? "—" : e.cobertura,
          e.tipo === "Gasto" ? "—" : e.obraSocial,
          `$${e.debe.toFixed(2)}`,
          `$${e.haber.toFixed(2)}`,
        ]),
        foot: [["", "", "", "", "Totales", `$${totalDebe.toFixed(2)}`, `$${totalHaber.toFixed(2)}`]],
        footStyles: { fontStyle: "bold" },
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
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl sm:text-3xl font-semibold text-[#001633]">Libro Diario</h2>
          {isSaving && (
            <span className="flex items-center gap-1 text-xs text-gray-400">
              <Loader2 className="h-3 w-3 animate-spin" />
              Guardando...
            </span>
          )}
        </div>
        <DatePicker date={fecha} setDate={setFecha} />
      </div>

      {isLoading && <div className="text-center py-4 text-gray-600">Cargando...</div>}
      {error && (
        <div className="text-red-800 bg-red-50 border border-red-200 rounded-lg p-3 text-sm">
          {error}
        </div>
      )}

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
                  const tipo = watchEntradas[index]?.tipo ?? "Paciente"
                  const esGasto = tipo === "Gasto"
                  return (
                    <TableRow key={field.id} className={index % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                      <TableCell className="text-center text-sm">{index + 1}</TableCell>
                      <TableCell>
                        <Select
                          value={tipo}
                          onValueChange={(value) => {
                            setValue(`entradas.${index}.tipo`, value as "Paciente" | "Gasto")
                            if (value === "Gasto") {
                              setValue(`entradas.${index}.cobertura`, "Particular")
                              setValue(`entradas.${index}.obraSocial`, "-")
                              setValue(`entradas.${index}.haber`, 0)
                            }
                          }}
                        >
                          <SelectTrigger className={`border-gray-300 focus:border-[#001633] text-xs ${esGasto ? "border-orange-300 bg-orange-50" : ""}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Paciente">Paciente</SelectItem>
                            <SelectItem value="Gasto">Gasto</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Input
                          {...register(`entradas.${index}.nombreApellido`)}
                          placeholder={esGasto ? "Descripción del gasto" : "Nombre y Apellido"}
                          className="border-gray-300 focus:border-[#001633]"
                        />
                      </TableCell>
                      <TableCell>
                        {esGasto ? (
                          <span className="text-gray-400 text-sm px-2">—</span>
                        ) : (
                          <Select
                            value={watchEntradas[index]?.cobertura ?? "Particular"}
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
                        )}
                      </TableCell>
                      <TableCell>
                        {esGasto ? (
                          <span className="text-gray-400 text-sm px-2">—</span>
                        ) : (
                          <Input
                            {...register(`entradas.${index}.obraSocial`)}
                            disabled={watchEntradas[index]?.cobertura === "Particular"}
                            className="border-gray-300 focus:border-[#001633] disabled:bg-gray-100 disabled:text-gray-400"
                          />
                        )}
                      </TableCell>
                      <TableCell>
                        <Input
                          {...register(`entradas.${index}.debe`, { valueAsNumber: true })}
                          type="number"
                          step="0.01"
                          min={0}
                          className="border-gray-300 focus:border-[#001633]"
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
                          onClick={() => handleRemove(index)}
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

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex gap-2">
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
        </div>

        <div className="flex gap-6 text-sm">
          <div className="text-center">
            <div className="text-gray-500 text-xs uppercase tracking-wide">Debe</div>
            <div className="font-bold text-lg">${totalDebe.toFixed(2)}</div>
          </div>
          <div className="text-center">
            <div className="text-gray-500 text-xs uppercase tracking-wide">Haber</div>
            <div className="font-bold text-lg">${totalHaber.toFixed(2)}</div>
          </div>
          <div className="text-center">
            <div className="text-gray-500 text-xs uppercase tracking-wide">Saldo</div>
            <div className={`font-bold text-lg ${saldo >= 0 ? "text-green-600" : "text-red-600"}`}>
              ${saldo.toFixed(2)}
            </div>
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
    </div>
  )
}
