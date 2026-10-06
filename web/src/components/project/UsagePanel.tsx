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
  const client = useMemo(() => createUsageClient({ baseUrl: API_URL, withAuth }), []);
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [open, setOpen] = useState(false);

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
      <div role="alert" className="flex items-center justify-between gap-3 px-3 py-2 bg-warning/10 border-b border-warning/20 text-xs">
        <span className="text-foreground">{t(load.errorKey)}</span>
        {load.errorKey !== 'usage.error.signIn' && load.errorKey !== 'usage.error.forbidden' && (
          <button onClick={() => { setLoad({ state: 'loading' }); void refresh(); }} className="shrink-0 px-3 py-1.5 font-medium bg-surface hover:bg-surface-hover border border-border rounded-lg transition">
            {t('usage.retry')}
          </button>
        )}
      </div>
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
  const tone = status.state === 'full' ? 'bg-danger/10 border-danger/20' : status.state === 'warn' ? 'bg-warning/10 border-warning/20' : 'bg-card border-border';

  return (
    <div className={`border-b ${tone}`}>
      <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
        <span className="text-foreground min-w-0" role={status.state === 'full' ? 'alert' : undefined}>{headline}</span>
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="shrink-0 px-3 py-1.5 font-medium bg-surface hover:bg-surface-hover border border-border rounded-lg transition"
        >
          {open ? t('usage.hide') : t('usage.manage')}
        </button>
      </div>

      {open && (
        <div className="px-3 pb-3 space-y-3 max-h-[50vh] overflow-y-auto">
          {series.length > 0 && (
            <section aria-label={t('usage.activityTitle', { days: data.days.length })} className="space-y-2">
              <h3 className="text-[10px] font-semibold text-subtle">{t('usage.activityTitle', { days: data.days.length })}</h3>
              <ul className="space-y-2">
                {series.map((s) => (
                  <li key={s.key} className="bg-surface rounded-lg p-3 flex items-end justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate">{t(`usage.feature.${s.key}`)}</p>
                      <p className="text-[10px] text-subtle">{t('usage.requests', { count: formatCount(s.total) })}</p>
                      {s.errors > 0 && <p className="text-[10px] text-warning">{t('usage.errors', { count: formatCount(s.errors) })}</p>}
                    </div>
                    <div className="flex items-end gap-1 h-8 shrink-0" role="img" aria-label={s.days.map((d, i) => t('usage.dayBar', { day: d, count: s.perDay[i] })).join(', ')}>
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
            <section aria-label={t('usage.capsTitle')} className="space-y-2">
              <h3 className="text-[10px] font-semibold text-subtle">{t('usage.capsTitle')}</h3>
              <ul className="space-y-2">
                {meters.map((m) => {
                  const name = t(`usage.meter.${m.key}.name`);
                  return (
                    <li key={m.key} className="bg-surface rounded-lg p-3 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-medium truncate">{name}</p>
                        <p className="text-[10px] text-subtle shrink-0">
                          {m.used === null ? t('usage.meterUnknown') : t('usage.meterOf', { used: formatMeterValue(m.unit, m.used), cap: formatMeterValue(m.unit, m.cap) })}
                        </p>
                      </div>
                      <div
                        role="progressbar"
                        aria-label={name}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={m.percent}
                        className="h-1.5 rounded-full bg-card overflow-hidden"
                      >
                        <div className={`h-full rounded-full ${FILL[m.state]}`} style={{ width: `${m.percent}%` }} />
                      </div>
                      {m.state === 'warn' && <p className="text-[10px] text-warning">{t('usage.stateWarn')}</p>}
                      {m.state === 'full' && (
                        <p role="alert" className="text-[10px] text-danger">
                          {t(`usage.meter.${m.key}.full`)} {t('usage.contact')}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
              <p className="text-[10px] text-subtle">{t('usage.resetsDaily')}</p>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
