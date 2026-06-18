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
        {/* Toasts de sonner (toast.success/error/...): esquina inferior derecha,
            con colores por tipo (richColors) y la animación fluida de sonner.
            El FAB "ir al final" del libro se movió a la izquierda para no pisarse. */}
        <Toaster position="bottom-right" richColors closeButton />
      </body>
    </html>
  )
}
