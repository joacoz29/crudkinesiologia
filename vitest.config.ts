import { defineConfig } from "vitest/config"
import path from "path"

// Tests unitarios de los módulos PUROS de lib/domain (sin Firebase ni React).
// Correr con `npm test`. El alias "@" replica el paths de tsconfig.
export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: { "@": path.resolve(__dirname) },
  },
})
