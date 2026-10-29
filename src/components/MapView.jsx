import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
// maplibre-gl 6 runs its tile work in a separate worker file and finds it next
// to its own module, which is not where Vite puts a bundled chunk. Shipping
// the worker as an asset and naming it here keeps the map inside the page's
// CSP (worker-src 'self').
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'

maplibregl.setWorkerUrl(workerUrl)

// One map for the whole site (MapLibre GL on Carto's Positron basemap, the
// same style the mapcn / flightcn component Wan sent uses). Markers are circles
// sized by `count`; a click calls onPick(marker) and the marker's `html`
// opens in a popup. The map fits every marker it is given and resizes with
// its box, so it works on a phone, a tablet and a desktop alike.
const STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'
export default function MapView({ markers = [], center = [108, 4], zoom = 1.6, height = 'h-72 sm:h-96', color = '#0b6b3a', onPick, fit = true, maxZoom = 6, className = '' }) {
  const box = useRef(null)
  const mapRef = useRef(null)
  const layer = useRef([])
  const pick = useRef(onPick); pick.current = onPick
  useEffect(() => {
    if (!box.current || mapRef.current) return
    const map = new maplibregl.Map({ container: box.current, style: STYLE, center, zoom, attributionControl: { compact: true }, renderWorldCopies: false, cooperativeGestures: true })
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    mapRef.current = map
    const ro = new ResizeObserver(() => map.resize()); ro.observe(box.current)
    return () => { ro.disconnect(); map.remove(); mapRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    const map = mapRef.current; if (!map) return
    layer.current.forEach((m) => m.remove()); layer.current = []
    const max = Math.max(1, ...markers.map((m) => m.count || 1))
    const bounds = new maplibregl.LngLatBounds()
    markers.forEach((m) => {
      if (!(m.lat != null && m.lng != null)) return
      const el = document.createElement('button')
      // Small dots (Wan, 15 Oct 2026): 14 to 28 px across, the count inside.
      const r = 7 + 7 * Math.sqrt((m.count || 1) / max)
      el.type = 'button'; el.setAttribute('aria-label', m.label || '')
      el.style.cssText = `width:${r * 2}px;height:${r * 2}px;border-radius:9999px;border:1.5px solid #fff;background:${m.color || color};opacity:.9;box-shadow:0 1px 3px rgba(0,0,0,.3);cursor:pointer;color:#fff;font:600 ${r < 10 ? 8 : 10}px system-ui;line-height:1;padding:0;display:flex;align-items:center;justify-content:center`
      el.textContent = m.count > 1 ? String(m.count) : ''
      el.title = m.label || ''
      const mk = new maplibregl.Marker({ element: el }).setLngLat([m.lng, m.lat])
      if (m.html) mk.setPopup(new maplibregl.Popup({ offset: r + 4, maxWidth: '280px' }).setHTML(m.html))
      el.addEventListener('click', () => pick.current && pick.current(m))
      mk.addTo(map); layer.current.push(mk); bounds.extend([m.lng, m.lat])
    })
    if (fit && markers.length) {
      const go = () => map.fitBounds(bounds, { padding: 48, maxZoom, duration: 0 })
      if (map.loaded()) go(); else map.once('load', go)
    }
  }, [markers, fit, maxZoom, color])
  // isolate: the map's own z-index must stay under the assistant panel
  return <div ref={box} className={`relative z-0 isolate rounded-lg overflow-hidden border border-line bg-paper ${height} ${className}`} />
}
