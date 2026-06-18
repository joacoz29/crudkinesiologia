import type { Metadata } from 'next'
import './globals.css'
import { Toaster } from '@/components/ui/sonner'

export const metadata: Metadata = {
  title: 'Gestión de Consultorio',
  description: 'Sistema de gestión de pacientes para consultorio kinesiológico',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="es">
      <body>
        {children}
        {/* Toasts de sonner (toast.success/error/...): no estaban montados, así que
            no se mostraba ningún aviso. En top-center para no pisar el FAB "ir al
            final" del libro ni los controles de abajo en mobile. */}
        <Toaster position="top-center" />
      </body>
    </html>
  )
}
