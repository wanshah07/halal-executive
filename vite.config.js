import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

// Relative base so the same build works at halalexecutive.kkmhalalconsultant.com
// and at wanshah07.github.io/halal-executive/. Routing is by #hash, so no
// path ever needs the base.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  // shadcn-style imports: '@/components/ui/…', '@/lib/utils'
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: { outDir: 'dist', sourcemap: false },
})
