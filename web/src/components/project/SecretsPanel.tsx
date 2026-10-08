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
  const ta = useTranslations('apps');
  const client = useMemo(() => createSecretsClient({ baseUrl: API_URL, withAuth }), []);
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [open, setOpen] = useState<boolean | null>(null); // null: open by itself while a key is still missing
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
      <section className="border-t border-border py-6">
        <h2 className="font-display text-lg font-semibold">{ta('keysTitle')}</h2>
        <div role="alert" className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <p className="text-warning">{t(load.errorKey)}</p>
          {load.errorKey !== 'secrets.error.signIn' && load.errorKey !== 'secrets.error.forbidden' && (
            <button onClick={() => { setLoad({ state: 'loading' }); void refresh(); }} className="h-10 shrink-0 rounded-lg border border-border px-4 text-sm font-medium transition hover:bg-surface">
              {t('secrets.retry')}
            </button>
          )}
        </div>
      </section>
    );
  }

  const rows = buildSecretRows(load.data.required, load.data.secrets);
  const { show, missing, total } = panelVisibility(rows);
  if (!show) return null;
  const pay = paySection(load.data);
  const required = rows.filter((r) => r.required);
  const extras = rows.filter((r) => !r.required);
  const isOpen = open ?? missing > 0;

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

  const quietBtn = 'h-10 rounded-lg border border-border px-3.5 text-sm font-medium transition hover:bg-surface disabled:opacity-50';

  const renderRow = (row: (typeof rows)[number]) => {
    const helpKey = payHelpKey(row.name);
    const editing = !row.isSet || replacing === row.name;
    const isBusy = busy === row.name;
    const inputId = `secret-input-${row.name}`;
    return (
      <li key={row.name} className="py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="break-all font-mono text-sm font-medium text-foreground">{row.name}</p>
            {row.connectors.length > 0 && (
              <p className="text-sm text-muted">{t('secrets.usedBy', { connectors: row.connectors.join(', ') })}</p>
            )}
            {(helpKey || row.purpose) && <p className="mt-0.5 max-w-[62ch] text-sm text-muted">{helpKey ? t(helpKey) : row.purpose}</p>}
          </div>
          <span className={`flex shrink-0 items-center gap-1.5 text-sm ${row.isSet ? 'text-success' : 'text-warning'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${row.isSet ? 'bg-success' : 'bg-warning'}`} />
            {row.isSet ? t('secrets.set') : t('secrets.notSet')}
          </span>
        </div>

        {editing && (
          <form
            onSubmit={(e) => { e.preventDefault(); void save(row.name); }}
            className="mt-3 flex flex-wrap items-stretch gap-2"
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
              className="h-10 min-w-[12rem] flex-1 rounded-lg border border-border bg-surface px-3 text-[15px] text-foreground placeholder:text-subtle focus:border-accent focus:outline-none"
            />
            <button
              type="submit"
              disabled={isBusy || !(drafts[row.name] ?? '').trim()}
              className="h-10 rounded-lg bg-accent px-4 text-sm font-semibold text-white transition hover:bg-accent-hover disabled:opacity-50"
            >
              {isBusy ? t('secrets.saving') : t('secrets.save')}
            </button>
            {row.isSet && (
              <button
                type="button"
                onClick={() => { setReplacing(null); setDrafts((d) => ({ ...d, [row.name]: '' })); setNote(null); }}
                className={quietBtn}
              >
                {t('secrets.cancel')}
              </button>
            )}
          </form>
        )}

        {row.isSet && !editing && confirming !== row.name && (
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={() => { setReplacing(row.name); setConfirming(null); setNote(null); }}
              disabled={isBusy}
              className={quietBtn}
            >
              {t('secrets.replace')}
            </button>
            <button
              onClick={() => setConfirming(row.name)}
              disabled={isBusy}
              className="h-10 rounded-lg px-3.5 text-sm font-medium text-danger transition hover:bg-danger/10 disabled:opacity-50"
            >
              {isBusy ? t('secrets.removing') : t('secrets.remove')}
            </button>
          </div>
        )}

        {row.isSet && !editing && confirming === row.name && (
          <div role="alertdialog" aria-labelledby={`remove-${row.name}`} className="mt-3 rounded-lg border border-danger/40 p-3">
            <p id={`remove-${row.name}`} className="font-medium text-foreground">{ta('keyRemoveTitle', { name: row.name })}</p>
            <p className="mt-1 text-sm text-muted">{ta('keyRemoveBody')}</p>
            <div className="mt-3 flex justify-end gap-2">
              <button onClick={() => setConfirming(null)} className={quietBtn}>{t('secrets.cancel')}</button>
              <button
                onClick={() => void remove(row.name)}
                disabled={isBusy}
                className="h-10 rounded-lg bg-danger px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
              >
                {isBusy ? t('secrets.removing') : t('secrets.remove')}
              </button>
            </div>
          </div>
        )}

        {note?.name === row.name && (
          <p role={note.kind === 'error' ? 'alert' : 'status'} className={`mt-2 text-sm ${note.kind === 'error' ? 'text-danger' : 'text-success'}`}>
            {note.text}
          </p>
        )}
      </li>
    );
  };

  return (
    <section className="border-t border-border py-6" aria-labelledby="app-keys-title">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="app-keys-title" className="font-display text-lg font-semibold">{ta('keysTitle')}</h2>
          <p className={`mt-0.5 ${missing > 0 ? 'text-warning' : 'text-muted'}`}>
            {total === 0
              ? t('secrets.title')
              : missing > 0
                ? t('secrets.summary', { missing, total })
                : t('secrets.summaryAllSet', { total })}
          </p>
        </div>
        <button
          onClick={() => setOpen(!isOpen)}
          aria-expanded={isOpen}
          className="-mr-3 h-10 shrink-0 rounded-lg px-3 text-sm font-medium text-accent-hover transition hover:bg-surface"
        >
          {isOpen ? t('secrets.hide') : t('secrets.manage')}
        </button>
      </div>

      {isOpen && (
        <div className="mt-3">
          <p className="max-w-[62ch] text-sm text-muted">{t('secrets.inputHint')}</p>
          {pay && (
            <div className="mt-4 rounded-xl border border-border bg-card p-4">
              <p className="max-w-[62ch] text-sm text-foreground">{t('secrets.pay.testFirst')}</p>
              <p className="mt-3 text-sm text-muted">{t('secrets.pay.webhookUrlLabel')}</p>
              {pay.webhookUrl ? (
                <div className="mt-2 flex items-stretch gap-2">
                  <input
                    readOnly
                    value={pay.webhookUrl}
                    aria-label={t('secrets.pay.webhookUrlLabel')}
                    onFocus={(e) => e.currentTarget.select()}
                    className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 font-mono text-sm text-foreground"
                  />
                  <button type="button" onClick={() => void copyWebhookUrl(pay.webhookUrl as string)} className={quietBtn}>
                    {urlCopied ? t('common.copied') : t('secrets.pay.copyUrl')}
                  </button>
                </div>
              ) : (
                <p className="mt-1 text-sm text-warning">{t('secrets.pay.webhookUrlPending')}</p>
              )}
            </div>
          )}
          <ul className="mt-2 divide-y divide-border">{required.map(renderRow)}</ul>
          {extras.length > 0 && (
            <>
              <h3 className="mt-4 text-sm font-medium text-muted">{t('secrets.extraTitle')}</h3>
              <ul className="divide-y divide-border">{extras.map(renderRow)}</ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}
