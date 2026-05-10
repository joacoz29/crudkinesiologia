"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { NewPatientModal } from "@/components/new-patient-modal"
import { EditPatientModal } from "@/components/edit-patient-modal"
import { LibroDiario } from "@/components/libro-diario"
import { Calendario } from "@/components/calendario"
import { Pencil, Trash2, Search, ChevronLeft, ChevronRight, LogOut, User2, AlertCircle, UserPlus, Users } from "lucide-react"
import { useState, useEffect, useCallback, useMemo } from "react"
import { db, auth } from "@/lib/firebase"
import { ref, remove, update } from "firebase/database"
import { fetchTurnosPorPaciente, writeLog } from "@/lib/helpers"
import { useRouter } from "next/navigation"
import { onAuthStateChanged, signOut, User } from "firebase/auth"
import { DeletePatientDialog } from "@/components/delete-patient-dialog"
import debounce from "lodash/debounce"
import { Patient } from "@/types"
import { getUserDisplayName, isAdmin } from "@/lib/auth-helper"
import { AdminPanel } from "@/components/admin-panel"
import { toast } from "sonner"

const AVATAR_COLORS = [
  "bg-blue-500", "bg-violet-500", "bg-emerald-500", "bg-orange-500",
  "bg-rose-500", "bg-indigo-500", "bg-teal-500", "bg-amber-600",
]

function getAvatarColor(seed: string): string {
  const hash = [...seed].reduce((acc, c) => acc + c.charCodeAt(0), 0)
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}

function getInitials(nombre: string, apellido: string): string {
  return `${nombre.charAt(0)}${apellido.charAt(0)}`.toUpperCase()
}

function countPatientSessions(sesiones: string[]): number {
  return [...sesiones.join(" ").matchAll(/\d+-/g)].length
}

function sessionBadgeClass(used: number, authorized: number): string {
  const ratio = used / authorized
  if (ratio >= 1) return "bg-red-50 text-red-600 border-red-200"
  if (ratio >= 0.8) return "bg-orange-50 text-orange-600 border-orange-200"
  return "bg-green-50 text-green-600 border-green-200"
}

function getPaginationPages(current: number, total: number): (number | "...")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages: (number | "...")[] = [1]
  if (current > 3) pages.push("...")
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) pages.push(i)
  if (current < total - 2) pages.push("...")
  pages.push(total)
  return pages
}

export default function Page() {
  const [modalOpen, setModalOpen] = useState(false)
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [patients, setPatients] = useState<Patient[]>([])
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null)
  const [searchTerm, setSearchTerm] = useState("")
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [currentUser, setCurrentUser] = useState<string | null>(null)
  const [isAdminUser, setIsAdminUser] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [patientToDelete, setPatientToDelete] = useState<Patient | null>(null)
  const [activeTab, setActiveTab] = useState("pacientes")
  const [calendarioRefreshTrigger, setCalendarioRefreshTrigger] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [totalItems, setTotalItems] = useState(0)
  const router = useRouter()
  const [libroDiarioUpdateTrigger, setLibroDiarioUpdateTrigger] = useState(0)

  const patientsPerPage = 10

  const fetchPatients = useCallback(async (search: string, page: number) => {
    const maxRetries = 3
    let attempt = 0
    setIsLoading(true)
    setError(null)

    while (attempt < maxRetries) {
      try {
        const response = await fetch(
          `/api/patients?search=${encodeURIComponent(search)}&page=${page}&limit=${patientsPerPage}`
        )

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }

        const data = await response.json()
        setPatients(data.patients)
        setTotalPages(data.pagination.totalPages)
        setTotalItems(data.pagination.totalItems)
        setIsLoading(false)
        return
      } catch (error) {
        attempt++
        if (attempt === maxRetries) {
          const errorMessage = error instanceof Error ? error.message : 'Error al cargar los pacientes'
          setError(errorMessage)
          toast.error(errorMessage)
          setIsLoading(false)
        } else {
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
        }
      }
    }
  }, [])

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user: User | null) => {
      if (user) {
        const displayName = getUserDisplayName(user)
        setCurrentUser(displayName)
        setIsAdminUser(isAdmin(user))
        fetchPatients("", 1)
      } else {
        router.push("/login")
      }
    })

    return () => unsubscribe()
  }, [router, fetchPatients])

  const handleEdit = (patient: Patient) => {
    setSelectedPatient(patient)
    setEditModalOpen(true)
  }

  const handleDelete = (patient: Patient) => {
    setPatientToDelete(patient)
    setIsDeleteDialogOpen(true)
  }

  const confirmDelete = async () => {
    if (patientToDelete) {
      try {
        const turnos = await fetchTurnosPorPaciente(patientToDelete.id)
        await Promise.all(turnos.map(t => remove(ref(db, `turnos/${t.fecha}/${t.id}`))))
        const patientRef = ref(db, `pacientes/${patientToDelete.id}`)
        await remove(patientRef)
        toast.success('Paciente eliminado correctamente')
        await writeLog({ accion: "eliminar_paciente", detalle: `Eliminó paciente ${patientToDelete.nombre} ${patientToDelete.apellido}`, entidadId: patientToDelete.id })
        const newPage = patients.length === 1 && currentPage > 1 ? currentPage - 1 : currentPage
        if (newPage !== currentPage) setCurrentPage(newPage)
        fetchPatients(searchTerm, newPage)
        setIsDeleteDialogOpen(false)
        setPatientToDelete(null)
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Error al eliminar el paciente'
        setError(errorMessage)
        toast.error(errorMessage)
      }
    }
  }

  const handleSaveEdit = async (updatedPatient: Patient) => {
    try {
      const patientRef = ref(db, `pacientes/${updatedPatient.id}`)
      const cleanPatient = JSON.parse(JSON.stringify(updatedPatient))
      await update(patientRef, cleanPatient)
      toast.success('Paciente actualizado correctamente')
      fetchPatients(searchTerm, currentPage)
      setEditModalOpen(false)
      setLibroDiarioUpdateTrigger((prev: number) => prev + 1)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Error al guardar los cambios'
      setError(errorMessage)
      toast.error(errorMessage)
    }
  }

  const debouncedSearch = useMemo(
    () => debounce((value: string) => fetchPatients(value, 1), 300),
    [fetchPatients]
  )

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setSearchTerm(value)
    setCurrentPage(1)
    debouncedSearch(value)
  }

  const handlePageChange = (page: number) => {
    setCurrentPage(page)
    fetchPatients(searchTerm, page)
  }

  const clearSearch = () => {
    setSearchTerm("")
    setCurrentPage(1)
    fetchPatients("", 1)
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-[#001633] text-white p-4 shadow-md">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col sm:flex-row items-center justify-between mb-4">
            <div className="mb-4 sm:mb-0 text-center sm:text-left">
              <h1 className="text-xl font-semibold tracking-tight">Kinesiología Integral</h1>
              <p className="text-xs text-white/50 mt-0.5">Lic. Ana Patricia Tullio</p>
            </div>
            <div className="flex items-center gap-4">
              <div className="bg-white text-[#001633] py-2 px-4 rounded-full flex items-center">
                <span className="mr-2">
                  <User2 className="w-4 h-4" />
                </span>
                <span className="font-medium">{currentUser}</span>
              </div>
              <Button
                variant="secondary"
                className="bg-white text-[#001633] hover:bg-gray-200 transition-colors flex items-center gap-2"
                onClick={() => {
                  signOut(auth).then(() => {
                    router.push("/login")
                  })
                }}
              >
                <LogOut className="w-4 h-4" />
                Cerrar sesión
              </Button>
            </div>
          </div>
          <nav className="flex gap-1 border-b border-white/20">
            {([
              "pacientes",
              "libroDiario",
              "calendario",
              ...(isAdminUser ? ["admin"] : []),
            ] as const).map((tab) => {
              const labels: Record<string, string> = { pacientes: "Pacientes", libroDiario: "Libro Diario", calendario: "Calendario", admin: "Admin" }
              return (
                <button
                  key={tab}
                  onClick={() => {
                    if (tab === "calendario" && activeTab !== "calendario") {
                      setCalendarioRefreshTrigger((t) => t + 1)
                    }
                    setActiveTab(tab)
                  }}
                  className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                    activeTab === tab
                      ? "text-white border-white"
                      : "text-white/60 border-transparent hover:text-white/90 hover:border-white/40"
                  }`}
                >
                  {labels[tab]}
                </button>
              )
            })}
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto py-8 px-4">
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div className="text-red-800">{error}</div>
          </div>
        )}
        
        {activeTab === "pacientes" ? (
          <>
            <h1 className="text-2xl sm:text-3xl font-semibold text-[#001633] mb-6">Pacientes Registrados</h1>

            <div className="flex flex-col sm:flex-row justify-between mb-6 gap-4">
              <div className="flex flex-col gap-1">
                <div className="relative w-full sm:w-80">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={16} />
                  <Input
                    type="search"
                    placeholder="Buscar por nombre, apellido o DNI..."
                    className="pl-9 pr-3 border-slate-200 focus:border-[#001633] focus:ring-[#001633] bg-white w-full"
                    value={searchTerm}
                    onChange={handleSearch}
                  />
                </div>
                <p className="text-xs text-slate-400 pl-1 h-4">
                  {!isLoading && (totalItems === 0
                    ? "Sin resultados"
                    : `${totalItems} paciente${totalItems !== 1 ? "s" : ""}${searchTerm ? " encontrados" : ""}`
                  )}
                </p>
              </div>
              <Button
                className="bg-[#001633] hover:bg-[#002966] transition-colors w-full sm:w-auto flex items-center gap-2"
                onClick={() => setModalOpen(true)}
              >
                <UserPlus className="h-4 w-4" />
                Nuevo Paciente
              </Button>
            </div>

            {/* Mobile cards */}
            <div className="flex flex-col gap-3 sm:hidden">
              {isLoading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3 animate-pulse">
                      <div className="h-10 w-10 rounded-full bg-slate-200 shrink-0" />
                      <div className="flex-1 space-y-2">
                        <div className="h-4 w-32 bg-slate-200 rounded" />
                        <div className="h-3 w-24 bg-slate-200 rounded" />
                      </div>
                    </div>
                  ))
                : patients.length === 0
                ? (
                    <div className="flex flex-col items-center gap-2 py-16 text-slate-400 bg-white rounded-xl border border-slate-200">
                      <Users className="h-10 w-10 text-slate-300" />
                      {searchTerm ? (
                        <>
                          <p className="font-medium text-slate-500 text-sm">Sin resultados para &quot;{searchTerm}&quot;</p>
                          <button onClick={clearSearch} className="text-sm text-[#001633] hover:underline">Limpiar búsqueda</button>
                        </>
                      ) : (
                        <p className="font-medium text-slate-500 text-sm">No hay pacientes registrados</p>
                      )}
                    </div>
                  )
                : patients.map((patient) => (
                    <div key={patient.id} className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3">
                      <div className={`h-10 w-10 rounded-full flex items-center justify-center text-white text-sm font-semibold shrink-0 ${getAvatarColor(patient.nombre + patient.apellido)}`}>
                        {getInitials(patient.nombre, patient.apellido)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-slate-800 truncate">{patient.nombre} {patient.apellido}</p>
                        <p className="text-xs text-slate-500 truncate">{patient.obraSocial}{patient.telefono ? ` · ${patient.telefono}` : ""}</p>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-slate-400 hover:text-white hover:bg-[#001633] transition-colors rounded-lg" onClick={() => handleEdit(patient)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-slate-400 hover:text-white hover:bg-red-500 transition-colors rounded-lg" onClick={() => handleDelete(patient)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))
              }
            </div>

            {/* Desktop table */}
            <div className="hidden sm:block overflow-x-auto rounded-xl shadow-sm">
              <div className="rounded-xl overflow-hidden min-w-full bg-white shadow-sm">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-[#001633] text-white hover:bg-[#001633]">
                      <TableHead className="w-10" />
                      <TableHead className="text-[11px] font-medium tracking-wider text-white/50">Nombre</TableHead>
                      <TableHead className="text-[11px] font-medium tracking-wider text-white/50">Apellido</TableHead>
                      <TableHead className="text-[11px] font-medium tracking-wider text-white/50 hidden sm:table-cell">Edad</TableHead>
                      <TableHead className="text-[11px] font-medium tracking-wider text-white/50 hidden sm:table-cell">DNI</TableHead>
                      <TableHead className="text-[11px] font-medium tracking-wider text-white/50 hidden sm:table-cell">Obra Social</TableHead>
                      <TableHead className="text-[11px] font-medium tracking-wider text-white/50 hidden sm:table-cell">N°AFL</TableHead>
                      <TableHead className="text-[11px] font-medium tracking-wider text-white/50 hidden sm:table-cell">Teléfono</TableHead>
                      <TableHead className="text-[11px] font-medium tracking-wider text-white/50 hidden sm:table-cell">Ses.</TableHead>
                      <TableHead className="w-20" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      Array.from({ length: 7 }).map((_, i) => (
                        <TableRow key={i} className="border-b border-slate-100 last:border-0">
                          <TableCell className="pl-4 pr-0 py-3">
                            <div className="h-8 w-8 rounded-full bg-slate-200 animate-pulse" />
                          </TableCell>
                          <TableCell className="py-3"><div className="h-4 w-28 bg-slate-200 rounded animate-pulse" /></TableCell>
                          <TableCell className="py-3"><div className="h-4 w-28 bg-slate-200 rounded animate-pulse" /></TableCell>
                          <TableCell className="py-3 hidden sm:table-cell"><div className="h-4 w-8 bg-slate-200 rounded animate-pulse" /></TableCell>
                          <TableCell className="py-3 hidden sm:table-cell"><div className="h-4 w-20 bg-slate-200 rounded animate-pulse" /></TableCell>
                          <TableCell className="py-3 hidden sm:table-cell"><div className="h-4 w-24 bg-slate-200 rounded animate-pulse" /></TableCell>
                          <TableCell className="py-3 hidden sm:table-cell"><div className="h-4 w-16 bg-slate-200 rounded animate-pulse" /></TableCell>
                          <TableCell className="py-3 hidden sm:table-cell"><div className="h-4 w-20 bg-slate-200 rounded animate-pulse" /></TableCell>
                          <TableCell className="py-3 hidden sm:table-cell"><div className="h-6 w-12 bg-slate-200 rounded-full animate-pulse" /></TableCell>
                          <TableCell className="py-3"><div className="h-8 w-16 bg-slate-200 rounded animate-pulse" /></TableCell>
                        </TableRow>
                      ))
                    ) : patients.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={10}>
                          <div className="flex flex-col items-center gap-2 py-16 text-slate-400">
                            <Users className="h-10 w-10 text-slate-300" />
                            {searchTerm ? (
                              <>
                                <p className="font-medium text-slate-500">Sin resultados para &quot;{searchTerm}&quot;</p>
                                <button onClick={clearSearch} className="text-sm text-[#001633] hover:underline mt-1">
                                  Limpiar búsqueda
                                </button>
                              </>
                            ) : (
                              <>
                                <p className="font-medium text-slate-500">No hay pacientes registrados</p>
                                <p className="text-sm">Usá &quot;Nuevo Paciente&quot; para agregar uno</p>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      patients.map((patient) => (
                            <TableRow key={patient.id} className="group bg-white hover:bg-slate-50/70 transition-colors border-b border-slate-100 last:border-0">
                              <TableCell className="pl-3 pr-0 py-3 border-l-[3px] border-l-transparent group-hover:border-l-[#001633] transition-colors">
                                <div className={`h-8 w-8 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0 ${getAvatarColor(patient.nombre + patient.apellido)}`}>
                                  {getInitials(patient.nombre, patient.apellido)}
                                </div>
                              </TableCell>
                              <TableCell className="py-3 font-semibold text-slate-900">{patient.nombre}</TableCell>
                              <TableCell className="py-3 font-semibold text-slate-900">{patient.apellido}</TableCell>
                              <TableCell className="py-3 text-sm text-slate-400 hidden sm:table-cell">{patient.edad}</TableCell>
                              <TableCell className="py-3 text-sm text-slate-400 hidden sm:table-cell">{patient.dni}</TableCell>
                              <TableCell className="py-3 text-sm text-slate-600 font-medium hidden sm:table-cell">{patient.obraSocial}</TableCell>
                              <TableCell className="py-3 text-sm text-slate-400 hidden sm:table-cell">{patient.nroAFL}</TableCell>
                              <TableCell className="py-3 text-sm text-slate-400 hidden sm:table-cell">{patient.telefono}</TableCell>
                              <TableCell className="py-3 hidden sm:table-cell">
                                {(() => {
                                  const tratsList = Array.isArray(patient.tratamientos) ? patient.tratamientos : []
                                  if (tratsList.length > 0) {
                                    const authorized = tratsList.reduce((sum, t) => sum + (t.sesionesAutorizadas ?? 0), 0)
                                    if (!authorized) return null
                                    const used = tratsList.reduce((sum, t) => sum + (Array.isArray(t.sesiones) ? t.sesiones.length : 0), 0)
                                    return (
                                      <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${sessionBadgeClass(used, authorized)}`}>
                                        {used}/{authorized}
                                      </span>
                                    )
                                  }
                                  const authorized = patient.sesionesAutorizadas
                                  if (!authorized) return null
                                  const used = countPatientSessions(patient.sesiones)
                                  return (
                                    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${sessionBadgeClass(used, authorized)}`}>
                                      {used}/{authorized}
                                    </span>
                                  )
                                })()}
                              </TableCell>
                              <TableCell className="py-3">
                                <div className="flex gap-1">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-8 w-8 p-0 text-slate-400 hover:text-white hover:bg-[#001633] transition-colors rounded-lg"
                                    onClick={() => handleEdit(patient)}
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-8 w-8 p-0 text-slate-400 hover:text-white hover:bg-red-500 transition-colors rounded-lg"
                                    onClick={() => handleDelete(patient)}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>

            {!isLoading && totalPages > 1 && (
              <div className="flex justify-center items-center mt-4 gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="h-8 w-8 p-0"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                {getPaginationPages(currentPage, totalPages).map((page, i) =>
                  page === "..." ? (
                    <span key={`e-${i}`} className="h-8 w-8 flex items-center justify-center text-slate-400 text-sm select-none">…</span>
                  ) : (
                    <Button
                      key={page}
                      variant="outline"
                      size="sm"
                      onClick={() => handlePageChange(page as number)}
                      className={`h-8 w-8 p-0 text-sm ${page === currentPage ? "bg-[#001633] text-white border-[#001633] hover:bg-[#002966] hover:text-white" : ""}`}
                    >
                      {page}
                    </Button>
                  )
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className="h-8 w-8 p-0"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}

            <NewPatientModal
              open={modalOpen}
              onOpenChange={(open) => {
                setModalOpen(open)
                if (!open) {
                  fetchPatients(searchTerm, currentPage)
                }
              }}
            />
            <EditPatientModal
              open={editModalOpen}
              onOpenChange={setEditModalOpen}
              patient={selectedPatient}
              onSave={handleSaveEdit}
              setLibroDiarioUpdateTrigger={setLibroDiarioUpdateTrigger}
            />
            <DeletePatientDialog
              isOpen={isDeleteDialogOpen}
              onClose={() => setIsDeleteDialogOpen(false)}
              onConfirm={confirmDelete}
              patientName={patientToDelete ? `${patientToDelete.nombre} ${patientToDelete.apellido}` : ""}
            />
          </>
        ) : activeTab === "libroDiario" ? (
          <LibroDiario updateTrigger={libroDiarioUpdateTrigger} />
        ) : activeTab === "calendario" ? (
          <Calendario refreshTrigger={calendarioRefreshTrigger} />
        ) : (
          <AdminPanel />
        )}
      </main>
    </div>
  )
}
