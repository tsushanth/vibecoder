'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { API_URL } from '@/lib/constants';
import { withAuth } from '@/lib/authHeader';
import {
  buildSecretRows,
  createSecretsClient,
  panelVisibility,
  submitSecret,
  type SecretErrorKey,
  type SecretsData,
} from '@/lib/secrets';
import { payHelpKey, paySection } from '@/lib/payKeys';

interface Props {
  projectId: string;
  /** Change this to re-read the list (for example after a build finishes and the app's manifest may have changed). */
  reloadKey?: string | number;
}

type Load =
  | { state: 'loading' }
  | { state: 'ready'; data: SecretsData }
  | { state: 'hidden' }
  | { state: 'error'; errorKey: SecretErrorKey };

type Note = { name: string; kind: 'ok' | 'error'; text: string };

// Keys the app needs, as declared by its connector manifest. Keys are write-only: this component never receives, stores or
// displays a stored key, and the pasted value lives only in the input until it is sent, then it is cleared.
export function SecretsPanel({ projectId, reloadKey }: Props) {
  const t = useTranslations();
  const client = useMemo(() => createSecretsClient({ baseUrl: API_URL, withAuth }), []);
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [replacing, setReplacing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const [urlCopied, setUrlCopied] = useState(false);

  const refresh = useCallback(async () => {
    const r = await client.list(projectId);
    if (r.ok) setLoad({ state: 'ready', data: r.data });
    // key storage not configured, or no such project: there is nothing to show, so say nothing
    else if (r.status === 503 || r.status === 404) setLoad({ state: 'hidden' });
    else setLoad({ state: 'error', errorKey: r.errorKey });
  }, [client, projectId]);

  // The manifest is registered shortly after a build finishes, so look again a little later too.
  useEffect(() => {
    let cancelled = false;
    const run = () => { if (!cancelled) void refresh(); };
    run();
    const timers = [setTimeout(run, 5000), setTimeout(run, 15000)];
    return () => { cancelled = true; timers.forEach(clearTimeout); };
  }, [refresh, reloadKey]);

  if (load.state === 'hidden') return null;
  if (load.state === 'loading') return null;

  if (load.state === 'error') {
    return (
      <div role="alert" className="flex items-center justify-between gap-3 px-3 py-2 bg-warning/10 border-b border-warning/20 text-xs">
        <span className="text-foreground">{t(load.errorKey)}</span>
        {load.errorKey !== 'secrets.error.signIn' && load.errorKey !== 'secrets.error.forbidden' && (
          <button onClick={() => { setLoad({ state: 'loading' }); void refresh(); }} className="shrink-0 px-3 py-1.5 font-medium bg-surface hover:bg-surface-hover border border-border rounded-lg transition">
            {t('secrets.retry')}
          </button>
        )}
      </div>
    );
  }

  const rows = buildSecretRows(load.data.required, load.data.secrets);
  const { show, missing, total } = panelVisibility(rows);
  if (!show) return null;
  const pay = paySection(load.data);
  const required = rows.filter((r) => r.required);
  const extras = rows.filter((r) => !r.required);

  async function save(name: string) {
    setNote(null);
    setBusy(name);
    const r = await submitSecret(client, projectId, name, drafts[name] ?? '');
    if (r.sent) setDrafts((d) => ({ ...d, [name]: '' })); // the key is never kept in the page, whatever the outcome
    if (r.ok) {
      setReplacing(null);
      setNote({ name, kind: 'ok', text: t('secrets.saved') });
      await refresh();
    } else {
      setNote({ name, kind: 'error', text: t(r.errorKey) });
    }
    setBusy(null);
  }

  async function remove(name: string) {
    setNote(null);
    setBusy(name);
    setConfirming(null);
    const r = await client.remove(projectId, name);
    if (r.ok) {
      setNote({ name, kind: 'ok', text: t('secrets.removed') });
      await refresh();
    } else {
      setNote({ name, kind: 'error', text: t(r.errorKey) });
    }
    setBusy(null);
  }

  async function copyWebhookUrl(url: string) {
    try { await navigator.clipboard.writeText(url); setUrlCopied(true); setTimeout(() => setUrlCopied(false), 2000); } catch { /* the URL is selectable text, so copying by hand still works */ }
  }

  const renderRow = (row: (typeof rows)[number]) => {
    const helpKey = payHelpKey(row.name);
    const editing = !row.isSet || replacing === row.name;
    const isBusy = busy === row.name;
    const inputId = `secret-input-${row.name}`;
    return (
      <li key={row.name} className="bg-surface rounded-lg p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-mono font-medium truncate">{row.name}</p>
            {row.connectors.length > 0 && (
              <p className="text-[10px] text-subtle truncate">{t('secrets.usedBy', { connectors: row.connectors.join(', ') })}</p>
            )}
            {(helpKey || row.purpose) && <p className="text-[10px] text-subtle whitespace-normal">{helpKey ? t(helpKey) : row.purpose}</p>}
          </div>
          <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-medium ${row.isSet ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}`}>
            {row.isSet ? t('secrets.set') : t('secrets.notSet')}
          </span>
        </div>

        {editing && (
          <form
            onSubmit={(e) => { e.preventDefault(); void save(row.name); }}
            className="flex items-stretch gap-1.5"
            autoComplete="off"
          >
            <label htmlFor={inputId} className="sr-only">{t('secrets.inputLabel', { name: row.name })}</label>
            <input
              id={inputId}
              name={`vb-key-${row.name}`}
              type="password"
              autoComplete="new-password"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-1p-ignore
              data-lpignore="true"
              value={drafts[row.name] ?? ''}
              onChange={(e) => { setDrafts((d) => ({ ...d, [row.name]: e.target.value })); setNote(null); }}
              placeholder={t('secrets.inputLabel', { name: row.name })}
              disabled={isBusy}
              className="flex-1 min-w-0 px-2.5 py-1.5 bg-card border border-border rounded-lg text-xs text-foreground placeholder:text-subtle focus:outline-none focus:border-accent transition"
            />
            <button
              type="submit"
              disabled={isBusy || !(drafts[row.name] ?? '').trim()}
              className="px-3 py-1.5 text-xs font-medium bg-accent hover:bg-accent-hover text-white rounded-lg transition disabled:opacity-50"
            >
              {isBusy ? t('secrets.saving') : t('secrets.save')}
            </button>
            {row.isSet && (
              <button
                type="button"
                onClick={() => { setReplacing(null); setDrafts((d) => ({ ...d, [row.name]: '' })); setNote(null); }}
                className="px-3 py-1.5 text-xs text-subtle hover:text-foreground bg-card border border-border rounded-lg transition"
              >
                {t('secrets.cancel')}
              </button>
            )}
          </form>
        )}

        {row.isSet && !editing && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setReplacing(row.name); setConfirming(null); setNote(null); }}
              disabled={isBusy}
              className="px-3 py-1 text-[11px] font-medium bg-card hover:bg-surface-hover border border-border rounded-lg transition disabled:opacity-50"
            >
              {t('secrets.replace')}
            </button>
            {confirming === row.name ? (
              <>
                <button
                  onClick={() => void remove(row.name)}
                  disabled={isBusy}
                  className="px-3 py-1 text-[11px] font-medium text-danger hover:bg-danger/10 border border-danger/30 rounded-lg transition disabled:opacity-50"
                >
                  {isBusy ? t('secrets.removing') : t('secrets.remove')}
                </button>
                <button onClick={() => setConfirming(null)} className="px-2 py-1 text-[11px] text-subtle hover:text-foreground transition">
                  {t('secrets.cancel')}
                </button>
              </>
            ) : (
              <button
                onClick={() => setConfirming(row.name)}
                disabled={isBusy}
                className="px-3 py-1 text-[11px] font-medium text-danger hover:bg-danger/10 border border-danger/30 rounded-lg transition disabled:opacity-50"
              >
                {t('secrets.remove')}
              </button>
            )}
          </div>
        )}

        {note?.name === row.name && (
          <p role={note.kind === 'error' ? 'alert' : 'status'} className={`text-[10px] ${note.kind === 'error' ? 'text-danger' : 'text-success'}`}>
            {note.text}
          </p>
        )}
      </li>
    );
  };

  return (
    <div className={`border-b ${missing > 0 ? 'bg-warning/10 border-warning/20' : 'bg-card border-border'}`}>
      <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
        <span className="text-foreground">
          {total === 0
            ? t('secrets.title')
            : missing > 0
              ? t('secrets.summary', { missing, total })
              : t('secrets.summaryAllSet', { total })}
        </span>
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="shrink-0 px-3 py-1.5 font-medium bg-surface hover:bg-surface-hover border border-border rounded-lg transition"
        >
          {open ? t('secrets.hide') : t('secrets.manage')}
        </button>
      </div>

      {open && (
        <div className="px-3 pb-3 space-y-2 max-h-[50vh] overflow-y-auto">
          <p className="text-[10px] text-subtle">{t('secrets.inputHint')}</p>
          {pay && (
            <div className="rounded-lg border border-border bg-card p-2.5 space-y-2">
              <p className="text-[11px] text-foreground">{t('secrets.pay.testFirst')}</p>
              <p className="text-[10px] text-subtle">{t('secrets.pay.webhookUrlLabel')}</p>
              {pay.webhookUrl ? (
                <div className="flex items-stretch gap-1.5">
                  <input
                    readOnly
                    value={pay.webhookUrl}
                    aria-label={t('secrets.pay.webhookUrlLabel')}
                    onFocus={(e) => e.currentTarget.select()}
                    className="flex-1 min-w-0 px-2.5 py-1.5 bg-surface border border-border rounded-lg text-[11px] font-mono text-foreground"
                  />
                  <button
                    type="button"
                    onClick={() => void copyWebhookUrl(pay.webhookUrl as string)}
                    className="px-3 py-1.5 text-xs font-medium bg-surface hover:bg-surface-hover border border-border rounded-lg transition"
                  >
                    {urlCopied ? t('common.copied') : t('secrets.pay.copyUrl')}
                  </button>
                </div>
              ) : (
                <p className="text-[10px] text-warning">{t('secrets.pay.webhookUrlPending')}</p>
              )}
            </div>
          )}
          <ul className="space-y-2">{required.map(renderRow)}</ul>
          {extras.length > 0 && (
            <>
              <h3 className="text-[10px] font-semibold text-subtle pt-1">{t('secrets.extraTitle')}</h3>
              <ul className="space-y-2">{extras.map(renderRow)}</ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
