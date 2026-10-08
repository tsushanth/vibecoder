'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { api, ApiError } from '@/lib/api';
import { isValidSubdomain } from '@/lib/utils';
import { deployBody, deployOutcome, describeDestructive, isConfirmationTyped, confirmPhrases, planDestructive, type DeployOutcome, type DestructiveItem, type Tone } from '@/lib/schemaDeploy';
import type { DeployResponse, DeploymentInfoResponse, DomainStatusResponse, AddDomainResponse, VerifyDomainResponse } from '@/types/api';

interface Props {
  projectId: string;
  userId: string;
  subscriptionTier?: string;
  /** Prefilled address for an app that is not published yet (the title in lowercase with hyphens, as on Android). */
  suggestedSubdomain?: string;
  onClose: () => void;
  onPublished: (url: string) => void;
}

export function PublishDialog({ projectId, userId, subscriptionTier, suggestedSubdomain, onClose, onPublished }: Props) {
  const t = useTranslations();
  const ta = useTranslations('apps.publish');
  const [subdomain, setSubdomain] = useState(suggestedSubdomain ?? '');
  const [confirmUnpublish, setConfirmUnpublish] = useState(false);
  const [isDeployed, setIsDeployed] = useState(false);
  const [liveUrl, setLiveUrl] = useState<string | null>(null);
  const [deployedAt, setDeployedAt] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeploying, setIsDeploying] = useState(false);
  const [isUndeploying, setIsUndeploying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Schema / jobs results of the last deploy, and the destructive-change confirmation
  const [outcome, setOutcome] = useState<DeployOutcome | null>(null);
  const [isPlanning, setIsPlanning] = useState(false);
  const [confirmItems, setConfirmItems] = useState<DestructiveItem[] | null>(null);
  const [typed, setTyped] = useState('');

  // Custom domain state
  const [customDomain, setCustomDomain] = useState('');
  const [domainStatus, setDomainStatus] = useState<DomainStatusResponse | null>(null);
  const [isDomainLoading, setIsDomainLoading] = useState(false);
  const [isDomainAdding, setIsDomainAdding] = useState(false);
  const [isDomainVerifying, setIsDomainVerifying] = useState(false);
  const [isDomainRemoving, setIsDomainRemoving] = useState(false);
  const [domainError, setDomainError] = useState<string | null>(null);

  useEffect(() => {
    loadDeploymentStatus();
  }, []);

  // Esc closes the dialog (or the confirmation on top of it)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (confirmItems) { setConfirmItems(null); setTyped(''); } else onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [confirmItems, onClose]);

  async function loadDeploymentStatus() {
    try {
      const data = await api.get<DeploymentInfoResponse>(
        `/api/deploy/${projectId}/deploy`
      );
      if (data.deployed && data.subdomain) {
        setIsDeployed(true);
        setSubdomain(data.subdomain);
        setLiveUrl(data.url ?? null);
        setDeployedAt(data.deployedAt ?? null);
        loadDomainStatus();
      }
    } catch {
      // Not deployed yet
    } finally {
      setIsLoading(false);
    }
  }

  async function loadDomainStatus() {
    setIsDomainLoading(true);
    try {
      const data = await api.get<DomainStatusResponse>(
        `/api/domains/${projectId}?userId=${userId}`
      );
      setDomainStatus(data);
      if (data.hasDomain && data.domain) {
        setCustomDomain(data.domain);
      }
    } catch {
      // No domain configured
    } finally {
      setIsDomainLoading(false);
    }
  }

  async function handleAddDomain() {
    setDomainError(null);
    if (!customDomain.trim()) return;
    setIsDomainAdding(true);
    try {
      await api.post<AddDomainResponse>(
        `/api/domains/${projectId}/add`,
        { userId, domain: customDomain.trim() }
      );
      await loadDomainStatus();
    } catch (err) {
      if (err instanceof ApiError) {
        setDomainError(err.message);
      } else {
        setDomainError(t('publish.addDomainFailed'));
      }
    } finally {
      setIsDomainAdding(false);
    }
  }

  async function handleVerifyDomain() {
    setDomainError(null);
    setIsDomainVerifying(true);
    try {
      await api.post<VerifyDomainResponse>(
        `/api/domains/${projectId}/verify`,
        { userId }
      );
      await loadDomainStatus();
    } catch (err) {
      setDomainError(err instanceof ApiError ? err.message : t('publish.verifyFailed'));
    } finally {
      setIsDomainVerifying(false);
    }
  }

  async function handleRemoveDomain() {
    setDomainError(null);
    setIsDomainRemoving(true);
    try {
      await api.delete(`/api/domains/${projectId}`, { userId });
      setDomainStatus(null);
      setCustomDomain('');
    } catch (err) {
      setDomainError(err instanceof ApiError ? err.message : t('publish.removeDomainFailed'));
    } finally {
      setIsDomainRemoving(false);
    }
  }

  async function handleDeploy(allowDestructive = false) {
    setError(null);
    setOutcome(null);
    const trimmed = subdomain.trim().toLowerCase();

    if (!isValidSubdomain(trimmed)) {
      setError(t('publish.subdomainError'));
      return;
    }

    // Updating an app that is already live: look first (read-only) at what the new schema would drop, and ask before deploying.
    if (!allowDestructive && isDeployed) {
      setIsPlanning(true);
      try {
        const plan = await api.get<unknown>(`/api/projects/${projectId}/schema/plan?subdomain=${encodeURIComponent(trimmed)}`);
        const items = planDestructive(plan);
        if (items.length) {
          setTyped('');
          setConfirmItems(items);
          return;
        }
      } catch {
        // The check is advisory: the server still refuses destructive changes that were not confirmed.
      } finally {
        setIsPlanning(false);
      }
    }

    setIsDeploying(true);
    try {
      const result = await api.post<DeployResponse>(
        `/api/deploy/${projectId}/deploy`,
        deployBody(userId, trimmed, allowDestructive)
      );
      setIsDeployed(true);
      setLiveUrl(result.url);
      setDeployedAt(new Date().toISOString());
      const out = deployOutcome(result);
      setOutcome(out);
      if (out.needsConfirmation && out.destructive.length) {
        setTyped('');
        setConfirmItems(out.destructive);
      }
      onPublished(result.url);
    } catch (err) {
      if (err instanceof ApiError && err.data?.error !== 'destructive_confirmation_requires_owner') {
        setError(err.message);
      } else {
        setError(t('publish.deployFailed'));
      }
    } finally {
      setIsDeploying(false);
    }
  }

  function handleCancelConfirm() {
    setConfirmItems(null);
    setTyped('');
  }

  function handleConfirmDestructive() {
    if (!confirmItems || !isConfirmationTyped(typed, confirmItems)) return;
    setConfirmItems(null);
    setTyped('');
    void handleDeploy(true);
  }

  async function handleUndeploy() {
    setConfirmUnpublish(false);
    setIsUndeploying(true);
    setError(null);
    try {
      await api.delete(`/api/deploy/${projectId}/deploy`, { userId });
      setIsDeployed(false);
      setLiveUrl(null);
      setDeployedAt(null);
      setDomainStatus(null);
      onPublished('');
    } catch {
      setError(t('publish.unpublishFailed'));
    } finally {
      setIsUndeploying(false);
    }
  }

  function handleCopy() {
    if (!liveUrl) return;
    navigator.clipboard.writeText(liveUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const isPro = subscriptionTier && subscriptionTier !== 'free';
  const quietBtn = 'flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium transition hover:bg-surface';

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-background/80" onClick={onClose} />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="publish-title"
        className="relative max-h-[92dvh] w-full overflow-y-auto rounded-t-xl border border-border bg-card sm:max-w-md sm:rounded-xl"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h2 id="publish-title" className="font-display text-lg font-semibold">{ta('title')}</h2>
          <button
            onClick={onClose}
            aria-label={ta('close')}
            className="-mr-2 flex h-10 w-10 items-center justify-center rounded-lg text-subtle transition hover:bg-surface hover:text-foreground"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-5">
          {isLoading ? (
            <div className="flex justify-center py-8">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            </div>
          ) : isDeployed && liveUrl ? (
            <div>
              <p className="flex items-center gap-2 text-success">
                <span className="h-2 w-2 rounded-full bg-success" />
                {ta('published')}
                {deployedAt && <span className="text-sm text-muted">{ta('publishedOn', { date: new Date(deployedAt).toLocaleDateString() })}</span>}
              </p>
              <a href={liveUrl} target="_blank" rel="noopener noreferrer" className="mt-1 block truncate text-accent-hover hover:underline">
                {liveUrl.replace(/^https?:\/\//, '')}
              </a>

              <div className="mt-4 flex gap-2">
                <button onClick={() => window.open(liveUrl, '_blank', 'noopener')} className={quietBtn}>{ta('open')}</button>
                <button onClick={handleCopy} className={quietBtn}>{copied ? ta('copied') : ta('copy')}</button>
                <button
                  onClick={() => {
                    if (navigator.share) {
                      navigator.share({ title: t('publish.shareTitle'), url: liveUrl }).catch(() => {});
                    } else {
                      handleCopy();
                    }
                  }}
                  className={quietBtn}
                >
                  {ta('share')}
                </button>
              </div>

              <div className="mt-5 border-t border-border pt-5">
                <p className="text-sm text-muted">{ta('updateHint')}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={() => handleDeploy()}
                    disabled={isDeploying || isPlanning}
                    className="h-10 flex-1 rounded-lg bg-accent px-4 text-sm font-semibold text-white transition hover:bg-accent-hover disabled:opacity-60"
                  >
                    {isPlanning ? t('publish.schema.checking') : isDeploying ? ta('updating') : ta('update')}
                  </button>
                  {!confirmUnpublish && (
                    <button
                      onClick={() => setConfirmUnpublish(true)}
                      disabled={isUndeploying}
                      className="h-10 rounded-lg px-4 text-sm font-medium text-danger transition hover:bg-danger/10 disabled:opacity-60"
                    >
                      {isUndeploying ? ta('unpublishing') : ta('unpublish')}
                    </button>
                  )}
                </div>
                {confirmUnpublish && (
                  <div role="alert" className="mt-3 rounded-lg border border-danger/40 p-3">
                    <p className="text-sm text-foreground">{ta('unpublishConfirm')}</p>
                    <div className="mt-3 flex justify-end gap-2">
                      <button onClick={() => setConfirmUnpublish(false)} className="h-10 rounded-lg border border-border px-4 text-sm font-medium transition hover:bg-surface">
                        {ta('cancel')}
                      </button>
                      <button onClick={handleUndeploy} className="h-10 rounded-lg bg-danger px-4 text-sm font-semibold text-white transition hover:opacity-90">
                        {ta('unpublish')}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Custom domain */}
              <div className="mt-5 border-t border-border pt-5">
                <h3 className="flex items-center gap-2 font-medium">
                  {ta('domainTitle')}
                  {!isPro && <span className="rounded-lg bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent-hover">{ta('pro')}</span>}
                </h3>

                {!isPro ? (
                  <p className="mt-1 text-sm text-muted">
                    {ta('domainPro')}{' '}
                    <Link href="/settings" className="text-accent-hover hover:underline">{ta('seePro')}</Link>
                  </p>
                ) : isDomainLoading ? (
                  <div className="flex justify-center py-3">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                  </div>
                ) : domainStatus?.hasDomain ? (
                  <div className="mt-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-foreground">{domainStatus.domain}</p>
                        <p className={`text-sm ${domainStatus.status === 'active' ? 'text-success' : 'text-warning'}`}>
                          {domainStatus.status === 'active' ? ta('domainActive') :
                           domainStatus.status === 'verified' ? ta('domainVerified') :
                           ta('domainPending')}
                        </p>
                      </div>
                      <button
                        onClick={handleRemoveDomain}
                        disabled={isDomainRemoving}
                        className="h-10 shrink-0 rounded-lg px-3 text-sm font-medium text-danger transition hover:bg-danger/10 disabled:opacity-60"
                      >
                        {isDomainRemoving ? ta('removing') : ta('remove')}
                      </button>
                    </div>

                    {domainStatus.status === 'pending' && domainStatus.cnameTarget && (
                      <>
                        <p className="mt-3 text-sm text-muted">{ta('dnsIntro')}</p>
                        <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 rounded-lg bg-surface p-3 text-sm">
                          <dt className="text-muted">{ta('dnsType')}</dt><dd className="font-mono">CNAME</dd>
                          <dt className="text-muted">{ta('dnsName')}</dt><dd className="break-all font-mono">{domainStatus.domain}</dd>
                          <dt className="text-muted">{ta('dnsValue')}</dt><dd className="break-all font-mono text-accent-hover">{domainStatus.cnameTarget}</dd>
                        </dl>
                        <button
                          onClick={handleVerifyDomain}
                          disabled={isDomainVerifying}
                          className="mt-3 h-10 w-full rounded-lg border border-border text-sm font-medium transition hover:bg-surface disabled:opacity-60"
                        >
                          {isDomainVerifying ? ta('verifying') : ta('verify')}
                        </button>
                      </>
                    )}
                  </div>
                ) : (
                  <form
                    onSubmit={(e) => { e.preventDefault(); void handleAddDomain(); }}
                    className="mt-2 flex items-stretch gap-2"
                  >
                    <label htmlFor="custom-domain" className="sr-only">{ta('domainTitle')}</label>
                    <input
                      id="custom-domain"
                      type="text"
                      inputMode="url"
                      autoCapitalize="off"
                      value={customDomain}
                      onChange={(e) => { setCustomDomain(e.target.value.toLowerCase().trim()); setDomainError(null); }}
                      placeholder="myapp.com"
                      className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 text-[15px] text-foreground placeholder:text-subtle focus:border-accent focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={isDomainAdding || !customDomain.trim()}
                      className="h-10 rounded-lg border border-border px-4 text-sm font-medium transition hover:bg-surface disabled:opacity-50"
                    >
                      {isDomainAdding ? ta('adding') : ta('add')}
                    </button>
                  </form>
                )}

                {domainError && <p role="alert" className="mt-2 text-sm text-danger">{domainError}</p>}
              </div>
            </div>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); void handleDeploy(); }}>
              <label htmlFor="publish-subdomain" className="block text-muted">{ta('intro')}</label>
              <div className="mt-3 flex items-stretch">
                <input
                  id="publish-subdomain"
                  type="text"
                  autoCapitalize="off"
                  autoComplete="off"
                  spellCheck={false}
                  value={subdomain}
                  onChange={(e) => {
                    setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''));
                    setError(null);
                  }}
                  placeholder="my-app"
                  className="h-11 min-w-0 flex-1 rounded-l-lg border border-border bg-surface px-3 text-[15px] text-foreground placeholder:text-subtle focus:border-accent focus:outline-none"
                />
                <span className="flex items-center rounded-r-lg border border-l-0 border-border bg-card px-3 text-sm text-muted">
                  {t('publish.domainSuffix')}
                </span>
              </div>
              <p className="mt-2 text-sm text-muted">{ta('addressHint')}</p>

              <button
                type="submit"
                disabled={isDeploying || !subdomain.trim()}
                className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 text-[15px] font-semibold text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isDeploying && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />}
                {isDeploying ? ta('publishing') : ta('publish')}
              </button>
            </form>
          )}

          {outcome && (outcome.schema || outcome.jobs) && (
            <div className="mt-4 space-y-1.5">
              {outcome.schema && <StatusLine heading={t('publish.schema.statusHeading')} text={t(outcome.schema.key)} tone={outcome.schema.tone} />}
              {outcome.jobs && <StatusLine heading={t('publish.jobs.heading')} text={t(outcome.jobs.key)} tone={outcome.jobs.tone} />}
            </div>
          )}

          {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
        </div>
      </div>

      {confirmItems && (
        <div className="absolute inset-0 z-10 flex items-center justify-center p-4" role="alertdialog" aria-modal="true" aria-labelledby="schema-confirm-title">
          <div className="absolute inset-0 bg-background/80" onClick={handleCancelConfirm} />
          <div className="relative max-h-[90dvh] w-full max-w-md space-y-3 overflow-y-auto rounded-xl border border-danger/40 bg-card p-5">
            <h3 id="schema-confirm-title" className="font-display text-lg font-semibold text-danger">{t('publish.schema.confirmTitle')}</h3>
            <p className="text-muted">{t('publish.schema.confirmIntro')}</p>
            <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
              {confirmItems.map((item, i) => {
                const d = describeDestructive(item);
                return <li key={`${item.kind}-${item.table}-${item.column ?? ''}-${i}`}>{t(d.key, d.values)}</li>;
              })}
            </ul>
            <p className="text-sm text-muted">{t('publish.schema.confirmTypeHint', { names: confirmPhrases(confirmItems).join(', ') })}</p>
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={t('publish.schema.confirmPlaceholder')}
              aria-label={t('publish.schema.confirmPlaceholder')}
              autoComplete="off"
              autoFocus
              className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-[15px] text-foreground placeholder:text-subtle focus:border-danger focus:outline-none"
            />
            <div className="flex justify-end gap-2">
              <button onClick={handleCancelConfirm} className="h-10 rounded-lg border border-border px-4 text-sm font-medium transition hover:bg-surface">
                {t('publish.schema.cancel')}
              </button>
              <button
                onClick={handleConfirmDestructive}
                disabled={!isConfirmationTyped(typed, confirmItems)}
                className="h-10 rounded-lg bg-danger px-4 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t('publish.schema.confirmButton')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const TONE_CLASS: Record<Tone, string> = { success: 'text-success', neutral: 'text-muted', warning: 'text-warning', error: 'text-danger' };

function StatusLine({ heading, text, tone }: { heading: string; text: string; tone: Tone }) {
  return (
    <p className={`text-sm ${TONE_CLASS[tone]}`}>
      <span className="font-semibold">{heading}: </span>
      {text}
    </p>
  );
}
