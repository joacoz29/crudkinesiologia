"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { NewPatientModal } from "@/components/new-patient-modal"
import { EditPatientModal } from "@/components/edit-patient-modal"
import { LibroDiario } from "@/components/libro-diario"
import { Pencil, Trash2, Search, ChevronLeft, ChevronRight, LogOut, User2 } from "lucide-react"
import { useState, useEffect } from "react"
import { db, auth } from "@/lib/firebase"
import { ref, query, get, remove, update } from "firebase/database"
import { useRouter } from "next/navigation"
import { onAuthStateChanged, signOut } from "firebase/auth"
import { DeletePatientDialog } from "@/components/delete-patient-dialog"
import { debounce } from "lodash"
import { Patient } from "@/types"

export default function PatientsPage() {
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
  const router = useRouter()
  const [libroDiarioUpdateTrigger, setLibroDiarioUpdateTrigger] = useState(0) // Added state for Libro Diario update trigger

  const patientsPerPage = 10

  useEffect(() => {
    console.log("PatientsPage component mounted")
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        console.log("User authenticated:", user.email)
        if (user.email === "kinesiologiaintegral@gmail.com") {
          setCurrentUser("Ana la Jefa")
        } else if (user.email === "eugenia@kinesiologia.com") {
          setCurrentUser("Eugenia Funk Martinez")
        } else if (user.email === "joaco@gmail.com") {
          setCurrentUser("Joaco")
        } else {
          setCurrentUser(user.displayName || user.email)
        }
        fetchPatients()
      } else {
        console.log("User not authenticated, redirecting to login")
        router.push("/login")
      }
    })

    return () => unsubscribe()
  }, [router])

  useEffect(() => {
    if (currentUser) {
      fetchPatients()
    }
  }, [currentUser]) // Removed unnecessary dependencies: searchTerm, currentPage

  const fetchPatients = async () => {
    const maxRetries = 3
    let attempt = 0

    while (attempt < maxRetries) {
      try {
        const searchParams = new URLSearchParams({
          search: searchTerm,
          page: currentPage.toString(),
          limit: patientsPerPage.toString()
        })

        const response = await fetch(`/api/patients?${searchParams}`, {
          // Aumentar el timeout del cliente
          next: { revalidate: 0 }, // No cache
          cache: 'no-store'
        })

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }

        const data = await response.json()
        setPatients(data.patients)
        setTotalPages(data.pagination.totalPages)
        break // Si llegamos aquí, la petición fue exitosa
      } catch (error) {
        attempt++
        console.error(`Attempt ${attempt} failed:`, error)
        
        if (attempt === maxRetries) {
          console.error("Error fetching patients after all retries:", error)
          // Podrías mostrar un mensaje de error al usuario aquí
        } else {
          // Esperar antes de reintentar
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
        }
      }
    }
  }

  const handleEdit = (patient: Patient) => {
    console.log("Editing patient:", patient)
    setSelectedPatient(patient)
    setEditModalOpen(true)
  }

  const handleDelete = (patient: Patient) => {
    console.log("Preparing to delete patient:", patient.id)
    setPatientToDelete(patient)
    setIsDeleteDialogOpen(true)
  }

  const confirmDelete = async () => {
    if (patientToDelete) {
      console.log("Confirming delete for patient:", patientToDelete.id)
      const patientRef = ref(db, `pacientes/${patientToDelete.id}`)
      await remove(patientRef)
      console.log("Patient deleted successfully")
      fetchPatients()
      setIsDeleteDialogOpen(false)
      setPatientToDelete(null)
    }
  }

  const handleSaveEdit = async (updatedPatient: Patient) => {
    console.log("Saving edited patient:", updatedPatient)
    const patientRef = ref(db, `pacientes/${updatedPatient.id}`)

    const patientToSave = {
      ...updatedPatient,
      sesiones: Array.isArray(updatedPatient.sesiones)
        ? updatedPatient.sesiones.join(", ")
        : updatedPatient.sesiones || "",
      sesionesAux: Array.isArray(updatedPatient.sesionesAux)
        ? updatedPatient.sesionesAux
        : updatedPatient.sesionesAux
          ? (updatedPatient.sesionesAux as string).split(", ")
          : [],
    }

    await update(patientRef, patientToSave)
    console.log("Patient updated successfully")
    fetchPatients()
    setEditModalOpen(false)

    // Trigger Libro Diario update
    setLibroDiarioUpdateTrigger((prev) => prev + 1)
  }

  const debouncedFetch = debounce((value: string) => {
    setSearchTerm(value)
    setCurrentPage(1)
    fetchPatients()
  }, 300)

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    debouncedFetch(e.target.value)
  }

  const handlePageChange = (page: number) => {
    setCurrentPage(page)
    fetchPatients()
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
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto py-8 px-4">
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
                />
                <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
              </div>
              <Button
                className="bg-[#001633] hover:bg-[#002966] transition-colors w-full sm:w-auto"
                onClick={() => setModalOpen(true)}
              >
                + Nuevo Paciente
              </Button>
            </div>

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
                    {patients.map((patient, index) => (
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
                    ))}
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

            <NewPatientModal
              open={modalOpen}
              onOpenChange={(open) => {
                setModalOpen(open)
                if (!open) {
                  fetchPatients()
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
        ) : (
          <LibroDiario
            newEntry={newDiarioEntry}
            key={newDiarioEntry?.id || "default"}
            updateTrigger={libroDiarioUpdateTrigger}
          />
        )}
      </main>
    </div>
  )
}

