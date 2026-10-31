import { useEffect, useState } from 'react'
import { cachedGet } from './lib/api'
import { checkReminders } from './lib/reminders'
import { useOnline } from './hooks/useOnline'
import { useHashRoute, href } from './hooks/useHashRoute'
import HomePage from './pages/HomePage'
import RoutePage from './pages/RoutePage'
import MapPage from './pages/MapPage'
import SavedPage from './pages/SavedPage'
import RemindersPage from './pages/RemindersPage'
import AlertsPage from './pages/AlertsPage'
import SafetyPage from './pages/SafetyPage'
import AboutPage from './pages/AboutPage'
import AdminPage from './admin/AdminPage'
import { Icon } from './components/Icons'

const NAV = [
  ['', 'search', 'Search', 'தேடு'], ['map', 'map', 'Map', 'வரைபடம்', true], ['saved', 'star', 'Saved', 'சேமித்தவை'],
  ['reminders', 'clock', 'Reminders', 'நினைவூட்டல்', true], ['alerts', 'alert', 'Alerts', 'அறிவிப்பு'], ['safety', 'shield', 'Safety', 'பாதுகாப்பு'], ['about', 'info', 'More', 'மேலும்'],
]

function Toasts() {
  const [list, setList] = useState([])
  useEffect(() => {
    const on = e => { const t = { id: Date.now() + Math.random(), ...e.detail }; setList(l => [...l, t]); setTimeout(() => setList(l => l.filter(x => x.id !== t.id)), 15000) }
    window.addEventListener('mbt:toast', on); return () => window.removeEventListener('mbt:toast', on)
  }, [])
  return <div className="toasts" aria-live="assertive">{list.map(t => <div key={t.id} className="toast" role="alert"><strong>{t.title}</strong><div>{t.body}</div>
    <button className="icon-btn" aria-label="Dismiss" onClick={() => setList(l => l.filter(x => x.id !== t.id))}>✕</button></div>)}</div>
}

export default function App() {
  const route = useHashRoute()
  const online = useOnline()
  const [meta, setMeta] = useState(null)

  useEffect(() => { cachedGet('/meta').then(r => setMeta(r.data), () => {}) }, [online])
  useEffect(() => {                       // local last-bus reminders: checked while the app is open
    checkReminders(); const t = setInterval(checkReminders, 30000); return () => clearInterval(t)
  }, [])

  const [page, a, b] = route.path
  let view
  if (!page) view = <HomePage />
  else if (page === 'route' && a) view = <RoutePage id={a} query={route.query} />
  else if (page === 'map') view = <MapPage />
  else if (page === 'saved') view = <SavedPage />
  else if (page === 'reminders') view = <RemindersPage query={route.query} />
  else if (page === 'alerts') view = <AlertsPage />
  else if (page === 'safety') view = <SafetyPage query={route.query} />
  else if (page === 'about') view = <AboutPage />
  else if (page === 'admin') view = <AdminPage />
  else view = <div className="page"><h1>Page not found</h1><a href={href('')}>Go to search</a></div>

  const sample = meta?.counts?.sample || 0
  const verified = meta?.counts?.verified || 0
  return (
    <div className="app">
      <header className="app-header">
        <div className="brand"><span className="logo"><Icon name="bus" size={22} /></span>
          <div><h1>Madurai Bus <span className="ta">மதுரை பஸ்</span></h1>
          <p>Schedule-based bus information · no live GPS</p></div></div>
        <nav className="nav" aria-label="Main">
          {NAV.map(([p, icon, label, ta, deskOnly]) => (
            <a key={p} href={href(p)} className={deskOnly ? 'desk-only' : ''} aria-current={(page || '') === p || (p === '' && page === 'route') ? 'page' : undefined}>
              <Icon name={icon} size={20} /><span>{label}</span><small>{ta}</small></a>))}
        </nav>
      </header>
      {!online && <div className="banner offline" role="status">You are offline. Saved routes and reminders still work; search needs internet. Schedules may be outdated.</div>}
      {meta && sample > 0 && <div className="banner" role="note">{verified === 0 ? 'No routes are verified yet. ' : ''}Some data is <strong>sample data</strong> for testing and is clearly labelled. Do not rely on it for travel. மாதிரி தரவு.</div>}
      {meta && !sample && verified === 0 && <div className="banner" role="note">No verified routes yet. Timings may be unverified.</div>}
      <main id="main">{view}</main>
      <Toasts />
    </div>
  )
}
