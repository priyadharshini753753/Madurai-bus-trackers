import { useEffect } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const dot = hl => {
  const s = hl ? 12 : 8
  return L.divIcon({ className: '', iconSize: [s, s], iconAnchor: [s / 2, s / 2],
    html: `<div style="background:${hl ? '#0B4F8A' : '#FFFFFF'};border:2px solid ${hl ? '#fff' : '#0B4F8A'};border-radius:50%;width:${s}px;height:${s}px"></div>` })
}

function Fit({ points }) {
  const map = useMap()
  useEffect(() => { if (points.length > 1) map.fitBounds(points, { padding: [24, 24], animate: false }) }, [points.length]) // eslint-disable-line
  return null
}

// routes: [{ id, routeNo, color, positions: [[lat,lng]…], stopNames }]   stops: [{ id, name, lat, lng }]
export default function BusMap({ routes, stops, activeIds, onPickRoute }) {
  const shown = routes.filter(r => r.positions.length > 1)
  const all = shown.flatMap(r => r.positions)
  const hot = new Set(shown.filter(r => !activeIds || activeIds.has(r.id)).flatMap(r => r.stopIds || []))
  return (
    <MapContainer center={[9.9252, 78.1198]} zoom={12} style={{ height: '100%', width: '100%' }}
      zoomAnimation={false} fadeAnimation={false} markerZoomAnimation={false}>
      <TileLayer attribution='&copy; <a href="https://openstreetmap.org">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <Fit points={all} />
      {shown.map(r => {
        const on = !activeIds || activeIds.has(r.id)
        return (
          <Polyline key={r.id} positions={r.positions}
            pathOptions={{ color: r.color, weight: on ? 4 : 2, opacity: on ? 0.85 : 0.25, dashArray: on ? null : '5 5' }}
            eventHandlers={onPickRoute ? { click: () => onPickRoute(r) } : undefined}>
            <Popup><strong>Route {r.routeNo}</strong>{r.isSample && <><br /><em>Sample data</em></>}</Popup>
          </Polyline>)
      })}
      {stops.filter(s => s.lat != null).map(s => (
        <Marker key={s.id} position={[s.lat, s.lng]} icon={dot(hot.has(s.id))}><Popup><strong>{s.name}</strong></Popup></Marker>
      ))}
    </MapContainer>
  )
}
