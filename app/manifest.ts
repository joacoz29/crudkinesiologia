import type { MetadataRoute } from 'next'

// Web App Manifest (servido en /manifest.webmanifest). Permite "instalar" la app
// en la pantalla de inicio (tablet de recepción) y, en mobile, tiñe la barra del
// navegador con theme_color. El ícono SVG con sizes "any" alcanza para que Chrome
// la considere instalable.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Kinesiología Integral',
    short_name: 'Kinesiología',
    description: 'Sistema de gestión de pacientes para consultorio kinesiológico',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#001633',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
    ],
  }
}
