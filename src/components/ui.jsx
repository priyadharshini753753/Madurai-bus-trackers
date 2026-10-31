import { Icon } from './Icons'
export const Loading = ({ text = 'Loading… ஏற்றுகிறது' }) => <div className="state" role="status"><span className="spinner" aria-hidden="true" /> {text}</div>
export const ErrorBox = ({ error, onRetry }) => (
  <div className="state state-error" role="alert">
    <strong>{error?.status === 0 ? 'You are offline' : 'Something went wrong'}</strong>
    <p>{error?.message || String(error)}</p>
    {onRetry && <button className="btn" onClick={onRetry}>Try again</button>}
  </div>
)
export const Empty = ({ children }) => <div className="state"><div className="big" aria-hidden="true"><Icon name="bus" size={34} /></div>{children}</div>
export const Notice = ({ kind = 'warn', children }) => <div className={`notice notice-${kind}`} role={kind === 'bad' ? 'alert' : 'note'}>{children}</div>
