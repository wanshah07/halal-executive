import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Served at the root of halalexecutive.kkmhalalconsultant.com (CNAME in public/),
// so base stays '/'. If it ever moves under a sub-path, set base here.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/',
  build: { outDir: 'dist', sourcemap: false },
})
