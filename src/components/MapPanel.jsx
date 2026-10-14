import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { MY_STATES, CHART } from '../lib/config'
import { t } from '../lib/i18n'

// Malaysia map with one circle marker per state, sized by the number of
// certificates on file there (events fall back in when there are none).
// Tiles are OpenStreetMap; the page needs network for them and renders the
// counts list underneath regardless.
export default function MapPanel({ lang, byState }) {
  const ref = useRef(null)
  const mapRef = useRef(null)
  useEffect(() => {
    if (!ref.current || mapRef.current) return
    const map = L.map(ref.current, { scrollWheelZoom: false, attributionControl: true }).setView([4.0, 109.5], 5)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 12, attribution: '© OpenStreetMap contributors' }).addTo(map)
    mapRef.current = { map, layer: L.layerGroup().addTo(map) }
    return () => { map.remove(); mapRef.current = null }
  }, [])
  useEffect(() => {
    if (!mapRef.current) return
    const { layer } = mapRef.current
    layer.clearLayers()
    const max = Math.max(1, ...Object.values(byState))
    MY_STATES.forEach((s) => {
      const n = byState[s.id] || 0
      if (!n) return
      L.circleMarker([s.lat, s.lng], { radius: 6 + 14 * Math.sqrt(n / max), color: '#fff', weight: 2, fillColor: CHART.light.halal, fillOpacity: 0.85 })
        .bindTooltip(`${s.id}: ${n}`, { direction: 'top' }).addTo(layer)
    })
  }, [byState])
  const list = Object.entries(byState).sort((a, b) => b[1] - a[1])
  return (
    <div className="card p-5">
      <h3 className="font-semibold mb-1">{t(lang, 'by_state')}</h3>
      <p className="text-xs text-ink-400 mb-3">{t(lang, 'map_hint')}</p>
      {/* isolate: Leaflet panes use z-index 400-1000 and would sit over the assistant panel */}
      <div ref={ref} className="relative z-0 isolate h-64 rounded-lg overflow-hidden border border-line" />
      {!list.length && <div className="text-sm text-ink-400 mt-3">{t(lang, 'no_data')}</div>}
      {!!list.length && <div className="mt-3 flex flex-wrap gap-2">{list.map(([k, v]) => <span key={k} className="chip bg-paper border border-line">{k} <b className="ml-1">{v}</b></span>)}</div>}
    </div>
  )
}
