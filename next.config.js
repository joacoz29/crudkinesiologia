/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    domains: ['firebasestorage.googleapis.com'],
  },
  // Deshabilitar la generación estática para las rutas dinámicas
  experimental: {
    appDir: true,
  },
}

module.exports = nextConfig 