import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useLoad } from '../hooks/useLoad'
import { Loading, ErrorBox } from '../components/ui'
import { Crud } from './shared'

function useList(path, key) {
  const { data, error, loading, reload } = useLoad(() => api.get(path))
  return { rows: data?.[key], error, loading, reload }
}

export function StopsAdmin() {
  const { rows, error, loading, reload } = useList('/admin/stops', 'stops')
  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  return <Crud title="Stops" rows={rows} blank={{ nameEn: '', nameTa: '', aliases: '', lat: '', lng: '', isActive: true }}
    extraRow={r => ({ aliases: (r.aliases || []).join(', ') })}
    columns={[['Name', r => <>{r.nameEn} {r.isSample && <span className="badge status-sample">sample</span>}</>], ['Tamil', r => r.nameTa], ['Aliases', r => (r.aliases || []).join(', ')], ['Lat/Lng', r => r.lat != null ? `${r.lat}, ${r.lng}` : '—'], ['Active', r => r.isActive ? 'Yes' : 'No']]}
    fields={[{ key: 'nameEn', label: 'Name (English)' }, { key: 'nameTa', label: 'Name (Tamil)' }, { key: 'aliases', label: 'Other spellings, comma separated (used by voice search)' },
      { key: 'lat', label: 'Latitude', type: 'number' }, { key: 'lng', label: 'Longitude', type: 'number' }, { key: 'isActive', label: 'Active', type: 'checkbox' }]}
    save={async f => { const b = { ...f, lat: f.lat === '' ? null : f.lat, lng: f.lng === '' ? null : f.lng }; f.id ? await api.put('/admin/stops/' + f.id, b) : await api.post('/admin/stops', b); reload() }} />
}

export function OperatorsAdmin() {
  const { rows, error, loading, reload } = useList('/admin/operators', 'operators')
  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  return <Crud title="Operators" rows={rows} blank={{ name: '', type: 'govt', authority: '', isActive: true }}
    columns={[['Name', r => r.name], ['Type', r => r.type], ['Authority', r => r.authority], ['Active', r => r.isActive ? 'Yes' : 'No']]}
    fields={[{ key: 'name', label: 'Name' }, { key: 'type', label: 'Type', type: 'select', options: [['govt', 'Government'], ['private', 'Private'], ['minibus', 'Mini-bus']] }, { key: 'authority', label: 'Authority / owner' }, { key: 'isActive', label: 'Active', type: 'checkbox' }]}
    save={async f => { f.id ? await api.put('/admin/operators/' + f.id, f) : await api.post('/admin/operators', f); reload() }} />
}

export function SourcesAdmin() {
  const { rows, error, loading, reload } = useList('/sources', 'sources')
  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  return <Crud title="Data sources" rows={rows} blank={{ name: '', type: 'official', url: '', notes: '' }}
    columns={[['Name', r => r.name], ['Type', r => r.type], ['URL', r => r.url ? <a href={r.url} target="_blank" rel="noreferrer">link</a> : '—'], ['Routes', r => r.routeCount]]}
    fields={[{ key: 'name', label: 'Name' }, { key: 'type', label: 'Type', type: 'select', options: ['official', 'operator', 'public_record', 'field_survey', 'user_submission'].map(x => [x, x]) }, { key: 'url', label: 'URL (https://…)' }, { key: 'notes', label: 'Notes' }]}
    save={async f => { f.id ? await api.put('/admin/sources/' + f.id, f) : await api.post('/admin/sources', f); reload() }} />
}
