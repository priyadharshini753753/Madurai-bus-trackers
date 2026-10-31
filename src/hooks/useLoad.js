import { useState, useEffect, useCallback, useRef } from 'react'

// Runs an async loader; exposes { data, error, loading, reload }.
// reload() refreshes quietly (keeps showing current data) once data exists; before that it shows loading.
export function useLoad(loader, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true })
  const ticket = useRef(0)
  const run = useCallback(silent => {
    const id = ++ticket.current
    if (!silent) setState({ data: null, error: null, loading: true })
    loader().then(
      data => { if (id === ticket.current) setState({ data, error: null, loading: false }) },
      error => { if (id === ticket.current) setState(s => ({ data: silent ? s.data : null, error: silent ? null : error, loading: false })) })
  }, deps)   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { run(false); return () => { ticket.current++ } }, [run])
  const reload = useCallback(() => run(state.data !== null), [run, state.data])
  return { ...state, reload }
}
