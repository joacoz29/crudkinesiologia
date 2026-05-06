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
import { ref, get, set, remove as firebaseRemove } from "firebase/database"
import { db } from "@/lib/firebase"
import { toast } from "sonner"

interface EntradaLibroDiario {
  id: string
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

export function LibroDiario({ newEntry, updateTrigger }: LibroDiarioProps) {
  const [fecha, setFecha] = useState<Date>(new Date())
  const [totalHaber, setTotalHaber] = useState(0)
  const [entryAdded, setEntryAdded] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastSavedData, setLastSavedData] = useState<string>("")
  const skipNextSave = useRef(false)

  const { register, control, watch, setValue } = useForm<{ entradas: EntradaLibroDiario[] }>({
    defaultValues: {
      entradas: [],
    },
  })

  const {
    fields,
    append,
    remove: removeField,
  } = useFieldArray({
    control,
    name: "entradas",
  })

  const watchEntradas = watch("entradas")

  const saveEntries = useCallback(
    async (entries: EntradaLibroDiario[]) => {
      setIsLoading(true)
      setError(null)
      try {
        if (!Array.isArray(entries)) {
          throw new Error("Entries is not an array")
        }

        const formattedDate = fecha.toISOString().split("T")[0]
        const libroDiarioRef = ref(db, `libroDiario/${formattedDate}`)

        const newTotalHaber = entries.reduce((sum, entrada) => sum + (entrada?.haber || 0), 0)

        await set(libroDiarioRef, {
          fecha: fecha.toISOString(),
          entradas: entries,
          totalHaber: newTotalHaber,
        })

        setTotalHaber(newTotalHaber)
        setLastSavedData(JSON.stringify(entries))
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Error desconocido'
        setError(`Error al guardar la entrada: ${errorMessage}`)
        toast.error(`Error al guardar: ${errorMessage}`)
      } finally {
        setIsLoading(false)
      }
    },
    [fecha],
  )

  useEffect(() => {
    if (skipNextSave.current) {
      skipNextSave.current = false
      return
    }
    if (watchEntradas && Array.isArray(watchEntradas)) {
      const currentData = JSON.stringify(watchEntradas)
      if (currentData !== lastSavedData) {
        saveEntries(watchEntradas)
        setLastSavedData(currentData)
      }
    }
  }, [watchEntradas, lastSavedData, saveEntries])

  useEffect(() => {
    if (watchEntradas && Array.isArray(watchEntradas)) {
      const total = watchEntradas.reduce((sum, entrada) => sum + (entrada?.haber || 0), 0)
      setTotalHaber(total)
    } else {
      setTotalHaber(0)
    }
  }, [watchEntradas])

  useEffect(() => {
    if (newEntry && newEntry.nombreApellido && !entryAdded) {
      const existingEntry = fields.find((field) => field.nombreApellido === newEntry.nombreApellido)
      if (!existingEntry) {
        append({
          id: (fields.length + 1).toString(),
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
    return () => {
      setEntryAdded(false)
    }
  }, [])

  const agregarFila = () => {
    append({
      id: (fields.length + 1).toString(),
      nombreApellido: "",
      cobertura: "Particular",
      obraSocial: "-",
      debe: 0,
      haber: 0,
    })
  }

  const exportarPDF = () => {
    if (!watchEntradas || !Array.isArray(watchEntradas)) {
      toast.error('No hay datos para exportar')
      return
    }

    try {
      const doc = new jsPDF()
      autoTable(doc, {
        head: [["N°", "Nombre y Apellido", "Cobertura", "Obra Social", "Debe", "Haber"]],
        body: watchEntradas.map((entrada, index) => [
          index + 1,
          entrada.nombreApellido,
          entrada.cobertura,
          entrada.obraSocial,
          `$${entrada.debe.toFixed(2)}`,
          `$${entrada.haber.toFixed(2)}`,
        ]),
        foot: [["", "", "", "Total", "", `$${totalHaber.toFixed(2)}`]],
      })
      doc.save(`${fecha.toISOString().split("T")[0]}_LibroDiario.pdf`)
      toast.success('PDF exportado correctamente')
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Error desconocido'
      toast.error(`Error al exportar PDF: ${errorMessage}`)
    }
  }

  const handleRemove = async (index: number) => {
    try {
      const formattedDate = fecha.toISOString().split("T")[0]
      const entryRef = ref(db, `libroDiario/${formattedDate}/entradas/${index}`)
      await firebaseRemove(entryRef)
      removeField(index)
      toast.success('Entrada eliminada correctamente')
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Error desconocido'
      setError(`Error al eliminar la entrada: ${errorMessage}`)
      toast.error(`Error: ${errorMessage}`)
    }
  }

  const fetchEntriesForDate = useCallback(
    async (date: Date) => {
      setIsLoading(true)
      setError(null)

      const formattedDate = date.toISOString().split("T")[0]
      const libroDiarioRef = ref(db, `libroDiario/${formattedDate}`)

      try {
        const snapshot = await get(libroDiarioRef)

        if (snapshot.exists()) {
          const data = snapshot.val()
          setValue("entradas", data.entradas || [])
          setTotalHaber(data.totalHaber || 0)
          setLastSavedData(JSON.stringify(data.entradas || []))
          skipNextSave.current = true
        } else {
          setValue("entradas", [])
          setTotalHaber(0)
          setLastSavedData("")
          skipNextSave.current = true
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Error desconocido'
        setError(`Error al cargar las entradas: ${errorMessage}`)
        toast.error(`Error: ${errorMessage}`)
      } finally {
        setIsLoading(false)
      }
    },
    [setValue],
  )

  useEffect(() => {
    fetchEntriesForDate(fecha)
  }, [fecha, fetchEntriesForDate])

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Libro Diario</h2>
        <DatePicker date={fecha} setDate={setFecha} />
      </div>
      {isLoading && <div className="text-center py-4 text-gray-600">Cargando...</div>}
      {error && <div className="text-red-500 text-center py-4">{error}</div>}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[50px]">N°</TableHead>
              <TableHead>Nombre y Apellido</TableHead>
              <TableHead>Cobertura</TableHead>
              <TableHead>Obra Social</TableHead>
              <TableHead>Debe</TableHead>
              <TableHead>Haber</TableHead>
              <TableHead className="w-[100px]">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!watchEntradas || watchEntradas.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-4 text-gray-600">
                  No hay entradas en el libro diario.
                </TableCell>
              </TableRow>
            ) : (
              watchEntradas.map((field, index) => (
                <TableRow key={field.id}>
                  <TableCell>{index + 1}</TableCell>
                  <TableCell>
                    <Input {...register(`entradas.${index}.nombreApellido` as const)} placeholder="Nombre y Apellido" />
                  </TableCell>
                  <TableCell>
                    <Select
                      onValueChange={(value) => {
                        setValue(`entradas.${index}.cobertura` as const, value as "Particular" | "Obra Social")
                        if (value === "Particular") {
                          setValue(`entradas.${index}.obraSocial` as const, "-")
                        }
                      }}
                      defaultValue={field.cobertura}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Seleccionar cobertura" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Particular">Particular</SelectItem>
                        <SelectItem value="Obra Social">Obra Social</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Input
                      {...register(`entradas.${index}.obraSocial` as const)}
                      disabled={watchEntradas[index]?.cobertura === "Particular"}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      {...register(`entradas.${index}.debe` as const, { valueAsNumber: true })}
                      type="number"
                      step="0.01"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      {...register(`entradas.${index}.haber` as const, { valueAsNumber: true })}
                      type="number"
                      step="0.01"
                    />
                  </TableCell>
                  <TableCell>
                    <Button type="button" variant="destructive" onClick={() => handleRemove(index)}>
                      Eliminar
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <div className="mt-4 flex justify-between items-center">
        <Button type="button" onClick={agregarFila}>
          + Agregar fila
        </Button>
        <div className="text-xl font-bold">Total: ${totalHaber.toFixed(2)}</div>
      </div>
      <div className="mt-4 flex justify-end space-x-2">
        <Button type="button" onClick={exportarPDF}>
          Exportar a PDF
        </Button>
      </div>
    </div>
  )
}
