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
import { Loader2 } from "lucide-react"

interface DeletePatientDialogProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  patientName: string
  /** Borrado en curso: deshabilita los botones y muestra spinner. */
  loading?: boolean
}

export function DeletePatientDialog({ isOpen, onClose, onConfirm, patientName, loading = false }: DeletePatientDialogProps) {
  return (
    // Mientras borra no se cierra por Esc/click afuera (los botones quedan deshabilitados).
    <AlertDialog open={isOpen} onOpenChange={(o) => { if (!o && !loading) onClose() }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Estás seguro que deseas borrar el registro?</AlertDialogTitle>
          <AlertDialogDescription>
            Esta acción no se puede deshacer. Se eliminará permanentemente el registro de {patientName}.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading} className="bg-red-500 text-white hover:bg-red-600">No</AlertDialogCancel>
          {/* preventDefault: que el borrado controle el cierre (cierra al terminar OK, sigue abierto si falla) */}
          <AlertDialogAction
            disabled={loading}
            onClick={(e) => { e.preventDefault(); onConfirm() }}
            className="bg-green-500 text-white hover:bg-green-600"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Eliminando...
              </>
            ) : (
              "Sí"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
