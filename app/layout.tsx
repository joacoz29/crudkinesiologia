import type { Metadata } from 'next'
import { Bricolage_Grotesque } from 'next/font/google'
import './globals.css'
import { Toaster } from '@/components/ui/sonner'

// Fuente principal: variable font auto-hosteada por Next (sin parpadeo ni pedido
// externo en runtime). Se expone como CSS var y se usa como `sans` en Tailwind.
const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-bricolage',
  display: 'swap',
})

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
    <html lang="es" className={bricolage.variable}>
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
