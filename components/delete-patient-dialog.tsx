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

interface DeletePatientDialogProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  patientName: string
}

export function DeletePatientDialog({ isOpen, onClose, onConfirm, patientName }: DeletePatientDialogProps) {
  return (
    <AlertDialog open={isOpen} onOpenChange={onClose}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Estás seguro que deseas borrar el registro?</AlertDialogTitle>
          <AlertDialogDescription>
            Esta acción no se puede deshacer. Se eliminará permanentemente el registro de {patientName}.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="bg-red-500 text-white hover:bg-red-600">No</AlertDialogCancel>
          <AlertDialogAction className="bg-green-500 text-white hover:bg-green-600" onClick={onConfirm}>
            Sí
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

