import { useState, useEffect } from 'react'

// "#/route/12?from=1&to=2" → { path: ['route','12'], query: { from:'1', to:'2' } }
export function parseHash(hash = window.location.hash) {
  const [p, q = ''] = hash.replace(/^#\/?/, '').split('?')
  return { path: p.split('/').filter(Boolean), query: Object.fromEntries(new URLSearchParams(q)) }
}
export function useHashRoute() {
  const [route, setRoute] = useState(parseHash)
  useEffect(() => {
    const on = () => { setRoute(parseHash()); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return route
}
export const href = (path, query) => `#/${path}${query ? '?' + new URLSearchParams(query) : ''}`
