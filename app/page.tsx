"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { NewPatientModal } from "@/components/new-patient-modal"
import { EditPatientModal } from "@/components/edit-patient-modal"
import { LibroDiario } from "@/components/libro-diario"
import { Calendario } from "@/components/calendario"
import { NuevoTurnoModal } from "@/components/nuevo-turno-modal"
import { Pencil, Trash2, Search, ChevronLeft, ChevronRight, LogOut, User2, AlertCircle, UserPlus, Users, CalendarPlus } from "lucide-react"
import { useState, useEffect, useMemo, useRef } from "react"
import { db, auth } from "@/lib/firebase"
import { ref, update } from "firebase/database"
import { fetchTurnosPorPaciente, writeLog } from "@/lib/helpers"
import { usePatients, queryPatients } from "@/lib/patients-store"
import { useRouter } from "next/navigation"
import { onAuthStateChanged, signOut, User } from "firebase/auth"
import { DeletePatientDialog } from "@/components/delete-patient-dialog"
import { Patient, Turno } from "@/types"
import { getUserDisplayName, isAdmin, canAccessLibroDiario } from "@/lib/auth-helper"
import { AdminPanel } from "@/components/admin-panel"
import { TareasPendientes } from "@/components/tareas-pendientes"
import { computeTareasPacientes } from "@/lib/tareas"
import { fetchFeriados } from "@/lib/feriados"
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
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null)
  const [searchTerm, setSearchTerm] = useState("")
  const [currentPage, setCurrentPage] = useState(1)
  const [currentUser, setCurrentUser] = useState<string | null>(null)
  const [isAdminUser, setIsAdminUser] = useState(false)
  const [canSeeLibroDiario, setCanSeeLibroDiario] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [patientToDelete, setPatientToDelete] = useState<Patient | null>(null)
  const [activeTab, setActiveTab] = useState("pacientes")
  const [calendarioRefreshTrigger, setCalendarioRefreshTrigger] = useState(0)
  // Deep-link al calendario (fecha + nonce para re-disparar la misma fecha)
  const [calTarget, setCalTarget] = useState<{ fecha: string; nonce: number } | null>(null)
  // Agendar turno desde la grilla de pacientes (paciente preseleccionado)
  const [agendaPatient, setAgendaPatient] = useState<Patient | null>(null)
  const [agendaOpen, setAgendaOpen] = useState(false)
  const [agendaFeriados, setAgendaFeriados] = useState<Record<string, string>>({})
  const hoyDate = useMemo(() => new Date(), [])
  const sinTurnos = useMemo<Record<string, Turno[]>>(() => ({}), [])
  const [mutationError, setMutationError] = useState<string | null>(null)

  const patientsPerPage = 10
  // Caché compartida (suscripción live a `pacientes`): búsqueda y paginación
  // se resuelven en memoria, sin volver a pegarle a la base.
  const { patients: allPatients, isLoading, error: storeError } = usePatients()
  const { patients, pagination } = useMemo(
    () => queryPatients(allPatients, { search: searchTerm, page: currentPage, limit: patientsPerPage }),
    [allPatients, searchTerm, currentPage],
  )
  const { totalPages, totalItems } = pagination
  // Conteo para el badge de la pestaña Pendientes. Solo tareas de paciente
  // (gratis desde la caché live); las de turno no se cuentan acá para no
  // disparar una lectura de turnos a nivel page.
  const pendientesCount = useMemo(() => computeTareasPacientes(allPatients).length, [allPatients])
  const error = mutationError ?? storeError
  const router = useRouter()

  // La pestaña activa se refleja en la URL (?tab=) para que recargar no vuelva a
  // Pacientes y el botón atrás/adelante navegue entre pestañas. `tabs` = pestañas
  // habilitadas según rol (la misma lista que renderiza la barra de navegación).
  const tabs = useMemo(
    () => [
      "pacientes",
      ...(canSeeLibroDiario ? ["libroDiario"] : []),
      "calendario",
      ...(isAdminUser || canSeeLibroDiario ? ["pendientes"] : []),
      ...(isAdminUser ? ["admin"] : []),
    ],
    [canSeeLibroDiario, isAdminUser],
  )

  // Cambia de pestaña y empuja la URL (pushState → atrás vuelve a la anterior).
  // El default "pacientes" deja la URL limpia, sin ?tab=. Next 14.2 soporta la
  // History API nativa para shallow routing, así que alcanza con window.history.
  const goToTab = (tab: string) => {
    setActiveTab(tab)
    window.history.pushState(null, "", tab === "pacientes" ? window.location.pathname : `?tab=${tab}`)
  }
  const [libroDiarioUpdateTrigger, setLibroDiarioUpdateTrigger] = useState(0)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user: User | null) => {
      if (user) {
        const displayName = getUserDisplayName(user)
        setCurrentUser(displayName)
        setIsAdminUser(isAdmin(user))
        setCanSeeLibroDiario(canAccessLibroDiario(user))
      } else {
        router.push("/login")
      }
    })

    return () => unsubscribe()
  }, [router])

  // Si una baja deja la página actual fuera de rango, retrocede a la última válida.
  useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) setCurrentPage(totalPages)
  }, [currentPage, totalPages])

  // Al cargar (una vez resuelto el auth, una sola vez): si la URL trae ?tab= y el
  // rol lo permite, abrir esa pestaña; si es inválida o es el default, limpiar la
  // URL. Esperar a `currentUser` garantiza que los roles ya están seteados.
  const tabRestoredRef = useRef(false)
  useEffect(() => {
    if (tabRestoredRef.current || !currentUser) return
    tabRestoredRef.current = true
    const urlTab = new URLSearchParams(window.location.search).get("tab")
    if (urlTab && urlTab !== "pacientes" && tabs.includes(urlTab)) setActiveTab(urlTab)
    else if (urlTab) window.history.replaceState(null, "", window.location.pathname)
  }, [currentUser, tabs])

  // Botón atrás/adelante del navegador: seguir la pestaña que indique la URL.
  useEffect(() => {
    const onPopState = () => {
      const urlTab = new URLSearchParams(window.location.search).get("tab") || "pacientes"
      setActiveTab(tabs.includes(urlTab) ? urlTab : "pacientes")
    }
    window.addEventListener("popstate", onPopState)
    return () => window.removeEventListener("popstate", onPopState)
  }, [tabs])

  const handleEdit = (patient: Patient) => {
    setSelectedPatient(patient)
    setEditModalOpen(true)
  }

  // Abre la ficha del paciente desde cualquier pestaña (el EditPatientModal está
  // montado a nivel de página, no dentro del branch de Pacientes). NO cambia de
  // pestaña: si lo abrís desde Pendientes, al cerrar/guardar seguís en Pendientes.
  const handleAbrirFicha = (patientId: string) => {
    const p = allPatients.find((x) => x.id === patientId)
    if (!p) return
    setSelectedPatient(p)
    setEditModalOpen(true)
  }

  // Deep-link desde Pendientes: ir al calendario posicionado en una fecha puntual.
  const handleIrCalendario = (fecha: string) => {
    setCalTarget({ fecha, nonce: Date.now() })
    setCalendarioRefreshTrigger((t) => t + 1)
    goToTab("calendario")
  }

  // Agendar un turno para un paciente directo desde la grilla (sin ir al calendario).
  const handleAgendarTurno = (patient: Patient) => {
    setAgendaPatient(patient)
    setAgendaOpen(true)
    const y = new Date().getFullYear()
    fetchFeriados([y, y + 1]).then(setAgendaFeriados).catch(() => {})
  }

  const handleDelete = (patient: Patient) => {
    setPatientToDelete(patient)
    setIsDeleteDialogOpen(true)
  }

  const confirmDelete = async () => {
    if (patientToDelete) {
      setMutationError(null)
      try {
        const turnos = await fetchTurnosPorPaciente(patientToDelete.id)
        // Borrado atómico: el paciente y todos sus turnos se nulifican en UNA
        // sola escritura multi-path (o se aplica todo o nada). Antes se borraban
        // por separado: si fallaba a mitad quedaban turnos huérfanos sin log.
        const updates: Record<string, null> = {
          [`pacientes/${patientToDelete.id}`]: null,
        }
        for (const t of turnos) {
          updates[`turnos/${t.fecha}/${t.id}`] = null
        }
        await update(ref(db), updates)
        toast.success('Paciente eliminado correctamente')
        await writeLog({ accion: "eliminar_paciente", detalle: `Eliminó paciente ${patientToDelete.nombre} ${patientToDelete.apellido}`, entidadId: patientToDelete.id })
        // La caché live refleja la baja sola; el clamp de página corrige el rango.
        setIsDeleteDialogOpen(false)
        setPatientToDelete(null)
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Error al eliminar el paciente'
        setMutationError(errorMessage)
        toast.error(errorMessage)
      }
    }
  }

  const handleSaveEdit = async (updatedPatient: Patient): Promise<boolean> => {
    setMutationError(null)
    try {
      const patientRef = ref(db, `pacientes/${updatedPatient.id}`)
      const cleanPatient = JSON.parse(JSON.stringify(updatedPatient))
      await update(patientRef, cleanPatient)
      toast.success('Paciente actualizado correctamente')
      setEditModalOpen(false)
      setLibroDiarioUpdateTrigger((prev: number) => prev + 1)
      return true
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Error al guardar los cambios'
      setMutationError(errorMessage)
      toast.error(errorMessage)
      return false
    }
  }

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Búsqueda instantánea en memoria (sin debounce ni red).
    setSearchTerm(e.target.value)
    setCurrentPage(1)
  }

  const handlePageChange = (page: number) => {
    setCurrentPage(page)
  }

  const clearSearch = () => {
    setSearchTerm("")
    setCurrentPage(1)
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
                className="bg-white text-[#001633] hover:bg-gray-200 flex items-center gap-2"
                onClick={async () => {
                  // Log antes de signOut: después ya no hay usuario autenticado para escribir
                  await writeLog({ accion: "logout", detalle: "Cerró sesión" })
                  await signOut(auth)
                  router.push("/login")
                }}
              >
                <LogOut className="w-4 h-4" />
                Cerrar sesión
              </Button>
            </div>
          </div>
          <nav className="flex gap-1 border-b border-white/20 overflow-x-auto whitespace-nowrap [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {tabs.map((tab) => {
              const labels: Record<string, string> = { pacientes: "Pacientes", libroDiario: "Libro Diario", calendario: "Calendario", pendientes: "Pendientes", admin: "Admin" }
              return (
                <button
                  key={tab}
                  onClick={() => {
                    if (tab === "calendario") {
                      if (activeTab !== "calendario") setCalendarioRefreshTrigger((t) => t + 1)
                      // Navegación manual al calendario: descartar un deep-link viejo
                      // para no re-saltar a esa fecha al re-entrar a la pestaña.
                      setCalTarget(null)
                    }
                    goToTab(tab)
                  }}
                  className={`shrink-0 whitespace-nowrap px-3 sm:px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                    activeTab === tab
                      ? "text-white border-white"
                      : "text-white/60 border-transparent hover:text-white/90 hover:border-white/40"
                  }`}
                >
                  {labels[tab]}
                  {tab === "pendientes" && pendientesCount > 0 && (
                    <span className="ml-1.5 inline-flex items-center justify-center min-w-[1.1rem] h-[1.1rem] px-1 text-[10px] font-bold rounded-full bg-amber-400 text-[#001633] align-middle">
                      {pendientesCount}
                    </span>
                  )}
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
                className="bg-[#001633] hover:bg-[#002966] w-full sm:w-auto flex items-center gap-2"
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
                        <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-slate-400 hover:text-white hover:bg-emerald-600 rounded-lg" title="Agendar turno" onClick={() => handleAgendarTurno(patient)}>
                          <CalendarPlus className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-slate-400 hover:text-white hover:bg-[#001633] rounded-lg" onClick={() => handleEdit(patient)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        {isAdminUser && (
                          <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-slate-400 hover:text-white hover:bg-red-500 rounded-lg" onClick={() => handleDelete(patient)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
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
                                    className="h-8 w-8 p-0 text-slate-400 hover:text-white hover:bg-emerald-600 rounded-lg"
                                    title="Agendar turno"
                                    onClick={() => handleAgendarTurno(patient)}
                                  >
                                    <CalendarPlus className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-8 w-8 p-0 text-slate-400 hover:text-white hover:bg-[#001633] rounded-lg"
                                    onClick={() => handleEdit(patient)}
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </Button>
                                  {isAdminUser && (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-8 w-8 p-0 text-slate-400 hover:text-white hover:bg-red-500 rounded-lg"
                                      onClick={() => handleDelete(patient)}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  )}
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
              onOpenChange={setModalOpen}
            />
            <DeletePatientDialog
              isOpen={isDeleteDialogOpen}
              onClose={() => setIsDeleteDialogOpen(false)}
              onConfirm={confirmDelete}
              patientName={patientToDelete ? `${patientToDelete.nombre} ${patientToDelete.apellido}` : ""}
            />
          </>
        ) : activeTab === "libroDiario" ? (
          canSeeLibroDiario ? <LibroDiario updateTrigger={libroDiarioUpdateTrigger} /> : null
        ) : activeTab === "calendario" ? (
          <Calendario
            refreshTrigger={calendarioRefreshTrigger}
            irAFecha={calTarget?.fecha}
            irAFechaNonce={calTarget?.nonce}
          />
        ) : activeTab === "pendientes" ? (
          (isAdminUser || canSeeLibroDiario)
            ? <TareasPendientes onAbrirFicha={handleAbrirFicha} onIrCalendario={handleIrCalendario} />
            : null
        ) : (
          isAdminUser ? <AdminPanel /> : null
        )}
      </main>

      {/* Editar paciente: montado a nivel de página (no dentro del branch de
          Pacientes) para poder abrir la ficha desde Pendientes sin cambiar de
          pestaña. Es un overlay, así que se ve sobre cualquier vista. */}
      <EditPatientModal
        open={editModalOpen}
        onOpenChange={setEditModalOpen}
        patient={selectedPatient}
        onSave={handleSaveEdit}
        setLibroDiarioUpdateTrigger={setLibroDiarioUpdateTrigger}
      />

      {/* Agendar turno desde la grilla de pacientes (paciente preseleccionado) */}
      {agendaPatient && (
        <NuevoTurnoModal
          open={agendaOpen}
          onOpenChange={(o) => {
            setAgendaOpen(o)
            if (!o) setAgendaPatient(null)
          }}
          fecha={hoyDate}
          pacienteInicial={agendaPatient}
          permitirElegirFecha
          turnosPorFecha={sinTurnos}
          feriados={agendaFeriados}
          onSaved={() => setCalendarioRefreshTrigger((t) => t + 1)}
        />
      )}
    </div>
  )
}
