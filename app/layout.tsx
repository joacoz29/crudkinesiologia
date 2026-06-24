import type { Metadata, Viewport } from 'next'
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
  icons: {
    icon: '/icon.svg',
    shortcut: '/icon.svg',
    apple: '/icon.svg',
  },
  // iOS standalone (Agregar a inicio): título corto y barra de estado clara.
  appleWebApp: {
    capable: true,
    title: 'Kinesiología',
    statusBarStyle: 'default',
  },
}

// theme-color: en Next 14 va en el export `viewport` (no en metadata). Tiñe la
// barra del navegador en mobile y el marco de la PWA con el azul del header.
export const viewport: Viewport = {
  themeColor: '#001633',
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
