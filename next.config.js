/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    domains: ['firebasestorage.googleapis.com'],
  },
  // Deshabilitar la generación estática para las páginas dinámicas
  experimental: {
    appDir: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
}

module.exports = nextConfig 