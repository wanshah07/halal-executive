import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import { readFileSync } from 'node:fs'

// Relative base so the same build works at halalexecutive.kkmhalalconsultant.com
// and at wanshah07.github.io/halal-executive/. Routing is by #hash, so no
// path ever needs the base.
// dist/boot.js (source src/boot.js): starts the feed requests and preloads the
// code of the page a link opens on, before the main bundle has arrived. The
// build writes which files each page needs into its PAGES map; the dev server
// serves it with an empty map.
const BOOT = fileURLToPath(new URL('./src/boot.js', import.meta.url))
function bootFile() {
  return {
    name: 'he-boot',
    configureServer(server) {
      server.middlewares.use('/boot.js', (_req, res) => { res.setHeader('Content-Type', 'text/javascript'); res.end(readFileSync(BOOT, 'utf8')) })
    },
    generateBundle(_opts, bundle) {
      const chunks = Object.values(bundle).filter((c) => c.type === 'chunk')
      const entry = chunks.find((c) => c.isEntry)
      const pages = {}
      for (const c of chunks) {
        // facadeModuleId is null for some page chunks (Overview): find the page
        // module among the chunk's own modules.
        const PAGE = /\/src\/pages\/([A-Za-z]+)\.jsx$/
        const m = c.isDynamicEntry && PAGE.exec(c.facadeModuleId || (c.moduleIds || []).find((id) => PAGE.test(id)) || '')
        if (!m) continue
        // The page's own code (static imports), and the stylesheets of
        // everything it may load later (a map's CSS inserted mid-load held the
        // first paint until it arrived).
        const files = new Set(), css = new Set(), seen = new Set()
        const walk = (f, code) => {
          const ch = bundle[f]
          if (!ch || seen.has(f + code) || (entry && f === entry.fileName)) return
          seen.add(f + code)
          if (code) files.add(f)
          ;((ch.viteMetadata && ch.viteMetadata.importedCss) || []).forEach((x) => css.add(x))
          ;(ch.imports || []).forEach((x) => walk(x, code))
          ;(ch.dynamicImports || []).forEach((x) => walk(x, false))
        }
        walk(c.fileName, true)
        pages[m[1].toLowerCase()] = [...files, ...css]
      }
      const src = readFileSync(BOOT, 'utf8')
      if (!src.includes('/*PAGES*/{}')) this.error('src/boot.js lost its /*PAGES*/{} marker')
      this.emitFile({ type: 'asset', fileName: 'boot.js', source: src.replace('/*PAGES*/{}', JSON.stringify(pages)) })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), bootFile()],
  base: './',
  // shadcn-style imports: '@/components/ui/…', '@/lib/utils'
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: { outDir: 'dist', sourcemap: false },
})
