import { lazy, Suspense } from 'react'
import { stateCoords, countryCoords } from '../lib/config'
import { t } from '../lib/i18n'

const MapView = lazy(() => import('./MapView'))

// Overview map: one circle per Malaysian state and one per country abroad,
// sized by the number of certificates on file there (events fall in too).
// Countries outside Malaysia plot on the same map (Wan, 15 Oct 2026).
export default function MapPanel({ lang, byState, abroad = {} }) {
  const markers = [
    ...Object.entries(byState).map(([k, n]) => { const ll = stateCoords(k); return ll && { id: k, lat: ll[0], lng: ll[1], count: n, label: `${k}: ${n}` } }),
    ...Object.entries(abroad).map(([k, n]) => { const ll = countryCoords(k); return ll && { id: k, lat: ll[0], lng: ll[1], count: n, label: `${k}: ${n}`, color: '#2a78d6' } }),
  ].filter(Boolean)
  const list = Object.entries(byState).sort((a, b) => b[1] - a[1])
  return (
    <div className="card p-5">
      <h3 className="font-semibold mb-1">{t(lang, 'by_state')}</h3>
      <p className="text-xs text-ink-400 mb-3">{t(lang, 'map_hint')}</p>
      <Suspense fallback={<div className="h-64 sm:h-80 rounded-lg bg-paper animate-pulse" />}>
        <MapView markers={markers} height="h-64 sm:h-80" maxZoom={6} />
      </Suspense>
      {!list.length && !Object.keys(abroad).length && <div className="text-sm text-ink-400 mt-3">{t(lang, 'no_data')}</div>}
      {!!list.length && <div className="mt-3 flex flex-wrap gap-2">{list.map(([k, v]) => <span key={k} className="chip bg-paper border border-line">{k} <b className="ml-1">{v}</b></span>)}</div>}
      {!!Object.keys(abroad).length && (
        <div className="mt-3 text-sm"><span className="text-ink-400">{t(lang, 'abroad')}:</span>{' '}
          {Object.entries(abroad).sort((a, b) => b[1] - a[1]).map(([k, v]) => <span key={k} className="chip bg-blue-50 border border-blue-200 text-blue-900 mr-1">{k} <b className="ml-1">{v}</b></span>)}</div>
      )}
    </div>
  )
}
