import { STATUS_LABEL, TYPE_LABEL, fmtDay } from '../lib/format'

export function StatusBadge({ status, verifiedAt }) {
  const s = STATUS_LABEL[status] || STATUS_LABEL.unverified
  return (
    <span className={`badge status-${status}`} title={s.tip}>
      <span aria-hidden="true">{s.icon}</span> {s.en}{status === 'verified' && verifiedAt ? ` · ${fmtDay(verifiedAt)}` : ''}
    </span>
  )
}
export function OperatorBadge({ type }) {
  const t = TYPE_LABEL[type]
  return <span className={`badge type-${type}`}>{t?.en} · {t?.ta}</span>
}
export function RouteNo({ no, color, big }) {
  return <span className={`route-no ${big ? 'big' : ''}`} style={{ background: color + '1F', borderColor: color }}>{no}</span>
}
