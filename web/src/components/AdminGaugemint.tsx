'use client'

// "Website visits (Gaugemint)" section of /admin: website visits of this site from Gaugemint (our own analytics). Data comes from
// /api/admin/gaugemint, which repeats the admin check and calls Gaugemint with a server-side read key. Nothing here talks to Gaugemint,
// and a failure here is contained: the health, issues and usage sections do not depend on it. The tracking tag is on the marketing
// pages only, so the numbers are landing-page visits, not app usage (the section says so).
import { useEffect, useState } from 'react'
import {
  GAUGEMINT_PERIODS, fmtDuration, gaugemintBars, isGaugemintResult,
  type GaugemintPeriod, type GaugemintResult, type GaugemintRow,
} from '@/lib/gaugemintTypes'

const W = 640, H = 90
const box: React.CSSProperties = { border: '1px solid #8884', borderRadius: 8, padding: 10 }
const th: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', opacity: 0.6, fontWeight: 500 }
const td: React.CSSProperties = { padding: '6px 8px', borderTop: '1px solid #8883', verticalAlign: 'top' }
const h2: React.CSSProperties = { fontSize: 13, textTransform: 'uppercase', letterSpacing: '.05em', opacity: 0.6, margin: '24px 0 8px' }
const PERIOD_LABEL: Record<GaugemintPeriod, string> = { '7d': '7 days', '30d': '30 days', '12mo': '12 months' }
const nf = (n: number) => Math.round(n).toLocaleString('en-US')

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ ...box, minWidth: 150, flex: '1 1 150px' }}>
      <div style={{ opacity: 0.6, fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600 }}>{value}</div>
    </div>
  )
}

function regionName(code: string): string {
  try {
    return /^[A-Za-z]{2}$/.test(code) ? new Intl.DisplayNames(['en'], { type: 'region' }).of(code.toUpperCase()) || code : code
  } catch { return code }
}

function Table({ title, rows, extra, label }: { title: string; rows: GaugemintRow[]; extra?: (r: any) => string; label?: (name: string) => string }) {
  return (
    <div style={{ ...box, flex: '1 1 300px', minWidth: 260 }}>
      <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>{title}</div>
      {rows.length === 0 ? <p style={{ opacity: 0.6, margin: 0 }}>No data in this period.</p> : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr><th style={th}>Name</th><th style={{ ...th, textAlign: 'right' }}>Visitors</th>{extra && <th style={{ ...th, textAlign: 'right' }}>Views</th>}</tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.name}>
              <td style={{ ...td, wordBreak: 'break-all' }}>{label ? label(r.name) : r.name}</td>
              <td style={{ ...td, textAlign: 'right' }}>{nf(r.visitors)}</td>
              {extra && <td style={{ ...td, textAlign: 'right' }}>{extra(r)}</td>}
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  )
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <section aria-label="Website visits (Gaugemint)">
      <h2 style={{ ...h2, marginTop: 32 }}>Website visits (Gaugemint)</h2>
      <p style={{ opacity: 0.6, fontSize: 12, margin: '0 0 4px' }}>Landing-page visits only: the tracking tag is on the marketing pages, not inside the app, so this is not app usage.</p>
      {children}
    </section>
  )
}

export default function AdminGaugemint({ token }: { token?: string | null }) {
  const [period, setPeriod] = useState<GaugemintPeriod>('30d')
  const [res, setRes] = useState<GaugemintResult | null>(null)
  const [err, setErr] = useState('')
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    let cancelled = false
    setRes(null)
    setErr('')
    ;(async () => {
      try {
        const r = await fetch(`/api/admin/gaugemint?period=${period}`, { cache: 'no-store', headers: token ? { Authorization: `Bearer ${token}` } : undefined })
        if (r.status === 404) { if (!cancelled) setHidden(true); return } // not an admin: the dashboard above already says so
        const j: unknown = await r.json().catch(() => null) // a Gaugemint error also arrives as JSON ({ ok:false, error }) with a 5xx status
        if (!isGaugemintResult(j)) throw new Error(`Unexpected response (HTTP ${r.status})`)
        if (!cancelled) setRes(j)
      } catch (e: any) { if (!cancelled) setErr(e.message || 'failed to load') }
    })()
    return () => { cancelled = true }
  }, [period, token])

  const picker = (
    <div style={{ display: 'flex', gap: 8, margin: '12px 0 0', flexWrap: 'wrap' }}>
      {GAUGEMINT_PERIODS.map((p) => (
        <button key={p} onClick={() => setPeriod(p)} aria-pressed={p === period} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #8886', fontWeight: p === period ? 700 : 400, background: p === period ? '#8882' : 'transparent' }}>{PERIOD_LABEL[p]}</button>
      ))}
    </div>
  )

  if (hidden) return null

  if (err) return <Section>{picker}<p style={{ ...box, marginTop: 16 }}>Website visits: {err}</p></Section>
  if (!res) return <Section>{picker}<p style={{ marginTop: 16, opacity: 0.6 }}>Loading website visits…</p></Section>

  if (!res.ok) {
    const off = res.error.kind === 'not_configured'
    return (
      <Section>
        {picker}
        <div role="alert" style={{ ...box, marginTop: 16 }}>
          <b>{off ? 'Website visits are not configured' : 'Website visits are unavailable'}</b>
          <div style={{ opacity: 0.8, marginTop: 4 }}>{res.error.message}</div>
          {off && <div style={{ opacity: 0.6, fontSize: 12, marginTop: 4 }}>The rest of the admin is not affected. Set the Fly secret GAUGEMINT_READ_KEY (a read-only Gaugemint key for this site) to turn it on.</div>}
        </div>
      </Section>
    )
  }

  const { stats } = res
  const t = stats.totals
  const { bars, max } = gaugemintBars(stats.series.map((p) => ({ day: p.day, value: p.visitors })), W, H)
  const unit = stats.granularity === 'month' ? 'month' : 'day'
  const first = stats.series[0]?.day, last = stats.series[stats.series.length - 1]?.day

  return (
    <Section>
      {picker}
      <h2 style={h2}>{stats.site}, last {PERIOD_LABEL[stats.period]}</h2>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Card label="Visitors" value={nf(t.visitors)} />
        <Card label="Pageviews" value={nf(t.pageviews)} />
        <Card label="Visits" value={nf(t.visits)} />
        <Card label="Bounce rate" value={`${Math.round(t.bounce_rate)}%`} />
        <Card label="Visit duration" value={fmtDuration(t.visit_duration)} />
      </div>

      <h2 style={h2}>Visitors per {unit}</h2>
      <div style={box}>
        {stats.series.length === 0 ? <p style={{ opacity: 0.6, margin: 0 }}>No data in this period.</p> : (<>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Visitors per ${unit}, ${stats.series.length} bars`}>
            <line x1="0" x2={W} y1={H - 0.5} y2={H - 0.5} stroke="#8886" />
            {bars.map((b) => (
              <rect key={b.day} x={b.x} y={b.y} width={b.w} height={b.h} fill="#4a7cff" opacity={0.9}>
                <title>{`${b.day}: ${nf(b.value)} visitors`}</title>
              </rect>
            ))}
          </svg>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, opacity: 0.5 }}>
            <span>{first}</span><span>peak {nf(max)}</span><span>{last}</span>
          </div>
        </>)}
        {stats.period === '12mo' && <p style={{ opacity: 0.5, fontSize: 11, margin: '6px 0 0' }}>One bar per month: the sum of daily visitors (a visitor code rotates daily, so a returning person counts once per day). Gaugemint only returns what it still stores.</p>}
      </div>

      <h2 style={h2}>Where visitors go and come from</h2>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Table title="Top pages" rows={stats.pages} extra={(r) => nf(r.pageviews)} />
        <Table title="Top sources" rows={stats.sources} />
        <Table title="Top countries" rows={stats.countries} label={regionName} />
        <Table title="Devices" rows={stats.devices} />
      </div>
      <p style={{ opacity: 0.5, fontSize: 11, marginTop: 12 }}>From Gaugemint, updated {new Date(res.fetchedAt).toLocaleTimeString()} (cached up to 60 s). Visitors respecting Do Not Track or Global Privacy Control are not counted.</p>
    </Section>
  )
}
