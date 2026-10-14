import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Relative base so the same build works at halalexecutive.kkmhalalconsultant.com
// and at wanshah07.github.io/halal-executive/. Routing is by #hash, so no
// path ever needs the base.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  build: { outDir: 'dist', sourcemap: false },
})
