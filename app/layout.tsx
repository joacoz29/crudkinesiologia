import type { Metadata } from 'next'
import './globals.css'

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
      <body>{children}</body>
    </html>
  )
}
