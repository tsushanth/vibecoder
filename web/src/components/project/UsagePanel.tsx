'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { API_URL } from '@/lib/constants';
import { withAuth } from '@/lib/authHeader';
import {
  USAGE_DAYS,
  barPercent,
  capMeters,
  createUsageClient,
  featureSeries,
  formatCount,
  formatMeterValue,
  overall,
  type Meter,
  type UsageData,
  type UsageErrorKey,
} from '@/lib/usage';

interface Props {
  projectId: string;
  /** Change this to re-read usage (for example after a build finishes or the app is published). */
  reloadKey?: string | number;
}

type Load =
  | { state: 'loading' }
  | { state: 'ready'; data: UsageData }
  | { state: 'hidden' }
  | { state: 'error'; errorKey: UsageErrorKey };

const FILL: Record<Meter['state'], string> = { ok: 'bg-accent', warn: 'bg-warning', full: 'bg-danger', unknown: 'bg-border' };

// What the creator's app has used: the last days of activity per feature, and current use against each cap. Numbers only come
// from the server; nothing here shows an end user's data.
export function UsagePanel({ projectId, reloadKey }: Props) {
  const t = useTranslations();
  const ta = useTranslations('apps');
  const client = useMemo(() => createUsageClient({ baseUrl: API_URL, withAuth }), []);
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [open, setOpen] = useState<boolean | null>(null); // null: open by itself when a limit is reached

  const refresh = useCallback(async () => {
    const r = await client.get(projectId, USAGE_DAYS);
    if (r.ok) setLoad({ state: 'ready', data: r.data });
    // usage not configured, or no such project: there is nothing to show, so say nothing
    else if (r.status === 503 || r.status === 404) setLoad({ state: 'hidden' });
    else setLoad({ state: 'error', errorKey: r.errorKey });
  }, [client, projectId]);

  useEffect(() => { void refresh(); }, [refresh, reloadKey]);

  if (load.state === 'hidden' || load.state === 'loading') return null;

  if (load.state === 'error') {
    return (
      <section className="border-t border-border py-6">
        <h2 className="font-display text-lg font-semibold">{ta('usageTitle')}</h2>
        <div role="alert" className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <p className="text-warning">{t(load.errorKey)}</p>
          {load.errorKey !== 'usage.error.signIn' && load.errorKey !== 'usage.error.forbidden' && (
            <button onClick={() => { setLoad({ state: 'loading' }); void refresh(); }} className="h-10 shrink-0 rounded-lg border border-border px-4 text-sm font-medium transition hover:bg-surface">
              {t('usage.retry')}
            </button>
          )}
        </div>
      </section>
    );
  }

  const { data } = load;
  if (data.apps === 0) return null; // the project has no running app yet
  const series = featureSeries(data);
  const meters = capMeters(data);
  const status = overall(meters);
  const totalCalls = series.reduce((n, s) => n + s.total, 0);
  const worstWarn = meters.filter((m) => m.state === 'warn').sort((a, b) => b.percent - a.percent)[0];
  const firstFull = meters.find((m) => m.state === 'full');

  const headline = firstFull
    ? t('usage.summaryFull', { name: t(`usage.meter.${firstFull.key}.name`) })
    : worstWarn
      ? t('usage.summaryWarn', { name: t(`usage.meter.${worstWarn.key}.name`), percent: worstWarn.percent })
      : totalCalls > 0
        ? t('usage.summary', { calls: formatCount(totalCalls), days: data.days.length || USAGE_DAYS })
        : t('usage.summaryNone', { days: data.days.length || USAGE_DAYS });
  const tone = status.state === 'full' ? 'text-danger' : status.state === 'warn' ? 'text-warning' : 'text-muted';
  const isOpen = open ?? status.state === 'full';

  return (
    <section className="border-t border-border py-6" aria-labelledby="usage-title">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="usage-title" className="font-display text-lg font-semibold">{ta('usageTitle')}</h2>
          <p className={`mt-0.5 ${tone}`} role={status.state === 'full' ? 'alert' : undefined}>
            {headline}
            {status.state === 'full' && (
              <>
                {' '}
                <a href="/settings" className="font-medium text-accent-hover underline">{t('usage.upgrade')}</a>
              </>
            )}
          </p>
        </div>
        <button
          onClick={() => setOpen(!isOpen)}
          aria-expanded={isOpen}
          className="-mr-3 h-10 shrink-0 rounded-lg px-3 text-sm font-medium text-accent-hover transition hover:bg-surface"
        >
          {isOpen ? t('usage.hide') : t('usage.manage')}
        </button>
      </div>

      {isOpen && (
        <div className="mt-4 space-y-6">
          {series.length > 0 && (
            <section aria-label={t('usage.activityTitle', { days: data.days.length })}>
              <h3 className="text-sm font-medium text-muted">{t('usage.activityTitle', { days: data.days.length })}</h3>
              <ul className="mt-1 divide-y divide-border">
                {series.map((s) => (
                  <li key={s.key} className="flex items-end justify-between gap-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{t(`usage.feature.${s.key}`)}</p>
                      <p className="text-sm text-muted">{t('usage.requests', { count: formatCount(s.total) })}</p>
                      {s.errors > 0 && <p className="text-sm text-warning">{t('usage.errors', { count: formatCount(s.errors) })}</p>}
                    </div>
                    <div className="flex h-9 shrink-0 items-end gap-1" role="img" aria-label={s.days.map((d, i) => t('usage.dayBar', { day: d, count: s.perDay[i] })).join(', ')}>
                      {s.perDay.map((v, i) => (
                        <span key={s.days[i]} className="w-2 rounded-sm bg-accent/70" style={{ height: `${barPercent(v, s.max)}%`, minHeight: v > 0 ? 2 : 0 }} title={t('usage.dayBar', { day: s.days[i], count: v })} />
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {meters.length > 0 && (
            <section aria-label={t('usage.capsTitle')}>
              <h3 className="text-sm font-medium text-muted">{t('usage.capsTitle')}</h3>
              <ul className="mt-1 divide-y divide-border">
                {meters.map((m) => {
                  const name = t(`usage.meter.${m.key}.name`);
                  return (
                    <li key={m.key} className="space-y-2 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="truncate font-medium">{name}</p>
                        <p className="shrink-0 text-sm text-muted tabular-nums">
                          {m.used === null ? t('usage.meterUnknown') : t('usage.meterOf', { used: formatMeterValue(m.unit, m.used), cap: formatMeterValue(m.unit, m.cap) })}
                        </p>
                      </div>
                      <div
                        role="progressbar"
                        aria-label={name}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={m.percent}
                        className="h-1.5 overflow-hidden rounded-full bg-surface"
                      >
                        <div className={`h-full rounded-full ${FILL[m.state]}`} style={{ width: `${m.percent}%` }} />
                      </div>
                      {m.state === 'warn' && <p className="text-sm text-warning">{t('usage.stateWarn')}</p>}
                      {m.state === 'full' && (
                        <p role="alert" className="text-sm text-danger">
                          {t(`usage.meter.${m.key}.full`)} {t('usage.contact')}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
              <p className="mt-1 text-sm text-muted">{t('usage.resetsDaily')}</p>
            </section>
          )}
        </div>
      )}
    </section>
  );
}
