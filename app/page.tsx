"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { NewPatientModal } from "@/components/new-patient-modal"
import { EditPatientModal } from "@/components/edit-patient-modal"
import { LibroDiario } from "@/components/libro-diario"
import { Calendario } from "@/components/calendario"
import { Pencil, Trash2, Search, ChevronLeft, ChevronRight, LogOut, User2, AlertCircle } from "lucide-react"
import { useState, useEffect, useCallback, useMemo } from "react"
import { db, auth } from "@/lib/firebase"
import { ref, remove, update } from "firebase/database"
import { useRouter } from "next/navigation"
import { onAuthStateChanged, signOut, User } from "firebase/auth"
import { DeletePatientDialog } from "@/components/delete-patient-dialog"
import debounce from "lodash/debounce"
import { Patient } from "@/types"
import { getUserDisplayName } from "@/lib/auth-helper"
import { toast } from "sonner"

export default function Page() {
  const [modalOpen, setModalOpen] = useState(false)
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [patients, setPatients] = useState<Patient[]>([])
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null)
  const [searchTerm, setSearchTerm] = useState("")
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [currentUser, setCurrentUser] = useState<string | null>(null)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [patientToDelete, setPatientToDelete] = useState<Patient | null>(null)
  const [activeTab, setActiveTab] = useState("pacientes")
  const [newDiarioEntry, setNewDiarioEntry] = useState<{ nombreApellido: string; id: string } | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
        const patientRef = ref(db, `pacientes/${patientToDelete.id}`)
        await remove(patientRef)
        toast.success('Paciente eliminado correctamente')
        fetchPatients(searchTerm, currentPage)
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
      await update(patientRef, updatedPatient)
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

  const handleAddToDiario = (nombreApellido: string) => {
    setNewDiarioEntry({ nombreApellido, id: Date.now().toString() })
  }

  return (
    <div className="min-h-screen bg-white">
      <header className="bg-[#001633] text-white p-4 shadow-md">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col sm:flex-row items-center justify-between mb-4">
            <h1 className="text-xl font-semibold mb-4 sm:mb-0">Gestión de Consultorio</h1>
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
          <nav className="flex space-x-4">
            <Button
              variant={activeTab === "pacientes" ? "secondary" : "ghost"}
              onClick={() => setActiveTab("pacientes")}
              className="text-white hover:text-white hover:bg-[#002966]"
            >
              Pacientes
            </Button>
            <Button
              variant={activeTab === "libroDiario" ? "secondary" : "ghost"}
              onClick={() => setActiveTab("libroDiario")}
              className="text-white hover:text-white hover:bg-[#002966]"
            >
              Libro Diario
            </Button>
            <Button
              variant={activeTab === "calendario" ? "secondary" : "ghost"}
              onClick={() => setActiveTab("calendario")}
              className="text-white hover:text-white hover:bg-[#002966]"
            >
              Calendario
            </Button>
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
            <h1 className="text-2xl sm:text-3xl font-semibold text-[#001633] mb-8">Pacientes Registrados</h1>

            <div className="flex flex-col sm:flex-row justify-between mb-6 gap-4">
              <div className="relative w-full sm:w-64">
                <Input
                  type="search"
                  placeholder="Buscar por nombre, apellido o DNI"
                  className="pl-3 pr-10 border-[#001633] focus:ring-[#001633] focus:border-[#001633] w-full"
                  value={searchTerm}
                  onChange={handleSearch}
                  disabled={isLoading}
                />
                <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
              </div>
              <Button
                className="bg-[#001633] hover:bg-[#002966] transition-colors w-full sm:w-auto"
                onClick={() => setModalOpen(true)}
                disabled={isLoading}
              >
                + Nuevo Paciente
              </Button>
            </div>

            {isLoading && (
              <div className="text-center py-8 text-gray-600">Cargando pacientes...</div>
            )}

            {!isLoading && (
              <>
                <div className="overflow-x-auto">
                  <div className="border border-[#001633] rounded-lg overflow-hidden min-w-full">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-[#001633] text-white">
                          <TableHead className="font-semibold w-12 text-center hidden sm:table-cell">#</TableHead>
                          <TableHead className="font-semibold">Nombre</TableHead>
                          <TableHead className="font-semibold">Apellido</TableHead>
                          <TableHead className="font-semibold hidden sm:table-cell">Edad</TableHead>
                          <TableHead className="font-semibold hidden sm:table-cell">DNI</TableHead>
                          <TableHead className="font-semibold hidden sm:table-cell">O.S</TableHead>
                          <TableHead className="font-semibold hidden sm:table-cell">N°AFL</TableHead>
                          <TableHead className="font-semibold hidden sm:table-cell">Teléfono</TableHead>
                          <TableHead className="font-semibold hidden sm:table-cell">DX</TableHead>
                          <TableHead className="font-semibold hidden sm:table-cell">DR</TableHead>
                          <TableHead className="font-semibold">Opciones</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {patients.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={11} className="text-center py-8 text-gray-600">
                              No hay pacientes registrados
                            </TableCell>
                          </TableRow>
                        ) : (
                          patients.map((patient, index) => (
                            <TableRow key={patient.id} className={index % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                              <TableCell className="text-center hidden sm:table-cell">
                                {(currentPage - 1) * patientsPerPage + index + 1}
                              </TableCell>
                              <TableCell>{patient.nombre}</TableCell>
                              <TableCell>{patient.apellido}</TableCell>
                              <TableCell className="hidden sm:table-cell">{patient.edad}</TableCell>
                              <TableCell className="hidden sm:table-cell">{patient.dni}</TableCell>
                              <TableCell className="hidden sm:table-cell">{patient.obraSocial}</TableCell>
                              <TableCell className="hidden sm:table-cell">{patient.nroAFL}</TableCell>
                              <TableCell className="hidden sm:table-cell">{patient.telefono}</TableCell>
                              <TableCell className="hidden sm:table-cell">{patient.diagnostico}</TableCell>
                              <TableCell className="hidden sm:table-cell">{patient.doctor}</TableCell>
                              <TableCell>
                                <div className="flex gap-2">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-8 w-8 p-0 hover:bg-[#001633] hover:text-white transition-colors"
                                    onClick={() => handleEdit(patient)}
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-8 w-8 p-0 hover:bg-red-600 hover:text-white transition-colors"
                                    onClick={() => handleDelete(patient)}
                                  >
                                    <Trash2 className="h-4 w-4" />
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

                {totalPages > 1 && (
                  <div className="flex justify-center items-center mt-4 gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handlePageChange(currentPage - 1)}
                      disabled={currentPage === 1}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm">
                      Página {currentPage} de {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handlePageChange(currentPage + 1)}
                      disabled={currentPage === totalPages}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </>
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
              onAddToDiario={handleAddToDiario}
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
          <LibroDiario
            newEntry={newDiarioEntry}
            key={newDiarioEntry?.id || "default"}
            updateTrigger={libroDiarioUpdateTrigger}
          />
        ) : (
          <Calendario />
        )}
      </main>
    </div>
  )
}
