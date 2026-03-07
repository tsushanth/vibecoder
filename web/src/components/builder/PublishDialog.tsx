'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { api, ApiError } from '@/lib/api';
import { isValidSubdomain } from '@/lib/utils';
import type { DeployResponse, DeploymentInfoResponse, DomainStatusResponse, AddDomainResponse, VerifyDomainResponse } from '@/types/api';

interface Props {
  projectId: string;
  userId: string;
  subscriptionTier?: string;
  onClose: () => void;
  onPublished: (url: string) => void;
}

export function PublishDialog({ projectId, userId, subscriptionTier, onClose, onPublished }: Props) {
  const t = useTranslations();
  const [subdomain, setSubdomain] = useState('');
  const [isDeployed, setIsDeployed] = useState(false);
  const [liveUrl, setLiveUrl] = useState<string | null>(null);
  const [deployedAt, setDeployedAt] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeploying, setIsDeploying] = useState(false);
  const [isUndeploying, setIsUndeploying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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

  async function handleDeploy() {
    setError(null);
    const trimmed = subdomain.trim().toLowerCase();

    if (!isValidSubdomain(trimmed)) {
      setError(t('publish.subdomainError'));
      return;
    }

    setIsDeploying(true);
    try {
      const result = await api.post<DeployResponse>(
        `/api/deploy/${projectId}/deploy`,
        { userId, subdomain: trimmed }
      );
      setIsDeployed(true);
      setLiveUrl(result.url);
      setDeployedAt(new Date().toISOString());
      onPublished(result.url);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError(t('publish.deployFailed'));
      }
    } finally {
      setIsDeploying(false);
    }
  }

  async function handleUndeploy() {
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Dialog */}
      <div className="relative w-full max-w-md mx-4 bg-card border border-border rounded-xl shadow-2xl animate-fade-in max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border sticky top-0 bg-card rounded-t-xl z-10">
          <h2 className="text-sm font-semibold">{t('publish.title')}</h2>
          <button
            onClick={onClose}
            className="text-subtle hover:text-foreground transition p-1"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            </div>
          ) : isDeployed && liveUrl ? (
            /* Already deployed state */
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-success text-xs font-medium">
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                {t('publish.published')}
              </div>

              <div className="bg-surface rounded-lg p-3">
                <div className="flex items-center justify-between gap-2">
                  <a
                    href={liveUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-accent hover:underline truncate"
                  >
                    {liveUrl}
                  </a>
                  <button
                    onClick={handleCopy}
                    className="shrink-0 px-2 py-1 text-[10px] text-subtle hover:text-foreground bg-surface-hover rounded transition"
                  >
                    {copied ? t('common.copied') : t('common.copy')}
                  </button>
                </div>
                {deployedAt && (
                  <p className="text-[10px] text-subtle mt-1.5">
                    {t('publish.deployedDate', { date: new Date(deployedAt).toLocaleDateString() })}
                  </p>
                )}
              </div>

              {/* Share buttons */}
              <div className="flex gap-2">
                <button
                  onClick={() => window.open(liveUrl, '_blank')}
                  className="flex-1 px-3 py-2 text-xs font-medium bg-surface hover:bg-surface-hover border border-border rounded-lg transition flex items-center justify-center gap-1.5"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                  {t('common.open')}
                </button>
                <button
                  onClick={handleCopy}
                  className="flex-1 px-3 py-2 text-xs font-medium bg-surface hover:bg-surface-hover border border-border rounded-lg transition flex items-center justify-center gap-1.5"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  {copied ? t('common.copied') : t('common.copy')}
                </button>
                <button
                  onClick={() => {
                    if (navigator.share) {
                      navigator.share({ title: t('publish.shareTitle'), url: liveUrl });
                    } else {
                      handleCopy();
                    }
                  }}
                  className="flex-1 px-3 py-2 text-xs font-medium bg-surface hover:bg-surface-hover border border-border rounded-lg transition flex items-center justify-center gap-1.5"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                  {t('common.share')}
                </button>
              </div>

              {/* Update / Unpublish */}
              <div className="flex gap-2">
                <button
                  onClick={handleDeploy}
                  disabled={isDeploying}
                  className="flex-1 px-4 py-2 text-xs font-medium bg-accent hover:bg-accent-hover text-white rounded-lg transition disabled:opacity-50"
                >
                  {isDeploying ? t('publish.updating') : t('publish.updateDeployment')}
                </button>
                <button
                  onClick={handleUndeploy}
                  disabled={isUndeploying}
                  className="px-4 py-2 text-xs font-medium text-danger hover:bg-danger/10 border border-danger/30 rounded-lg transition disabled:opacity-50"
                >
                  {isUndeploying ? '...' : t('publish.unpublish')}
                </button>
              </div>

              {/* Custom Domain Section */}
              <div className="pt-4 mt-2 border-t border-border">
                <h3 className="text-xs font-semibold mb-2 flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9" />
                  </svg>
                  {t('publish.customDomain')}
                  {!isPro && (
                    <span className="px-1.5 py-0.5 bg-accent/10 text-accent text-[10px] rounded font-normal">Pro</span>
                  )}
                </h3>

                {!isPro ? (
                  <p className="text-[10px] text-subtle">
                    {t('publish.customDomainProHint')}
                  </p>
                ) : isDomainLoading ? (
                  <div className="flex justify-center py-3">
                    <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : domainStatus?.hasDomain ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between bg-surface rounded-lg p-2.5">
                      <div>
                        <p className="text-xs font-medium">{domainStatus.domain}</p>
                        <p className={`text-[10px] mt-0.5 ${
                          domainStatus.status === 'active' ? 'text-success' :
                          domainStatus.status === 'verified' ? 'text-accent' :
                          'text-yellow-500'
                        }`}>
                          {domainStatus.status === 'active' ? t('publish.statusActive') :
                           domainStatus.status === 'verified' ? t('publish.statusVerified') :
                           t('publish.statusPending')}
                        </p>
                      </div>
                      <button
                        onClick={handleRemoveDomain}
                        disabled={isDomainRemoving}
                        className="text-[10px] text-danger hover:bg-danger/10 px-2 py-1 rounded transition"
                      >
                        {isDomainRemoving ? '...' : t('common.remove')}
                      </button>
                    </div>

                    {domainStatus.status === 'pending' && domainStatus.cnameTarget && (
                      <>
                        <div className="bg-surface rounded-lg p-2.5 space-y-1.5 text-[10px]">
                          <p className="font-medium text-foreground">{t('publish.dnsRequired')}</p>
                          <p className="text-muted">
                            {t('publish.dnsInstruction')} <span className="font-mono bg-surface-hover px-1 rounded">CNAME</span>
                          </p>
                          <p className="font-mono text-accent text-[9px] break-all">
                            {domainStatus.domain} → {domainStatus.cnameTarget}
                          </p>
                        </div>
                        <button
                          onClick={handleVerifyDomain}
                          disabled={isDomainVerifying}
                          className="w-full px-3 py-1.5 text-[10px] font-medium bg-accent/10 hover:bg-accent/20 text-accent rounded-lg transition disabled:opacity-50"
                        >
                          {isDomainVerifying ? t('publish.verifying') : t('publish.verifyDomain')}
                        </button>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="flex items-stretch gap-1.5">
                    <input
                      type="text"
                      value={customDomain}
                      onChange={(e) => { setCustomDomain(e.target.value.toLowerCase().trim()); setDomainError(null); }}
                      placeholder="myapp.com"
                      className="flex-1 min-w-0 px-2.5 py-1.5 bg-surface border border-border rounded-lg text-xs text-foreground placeholder:text-subtle focus:outline-none focus:border-accent transition"
                    />
                    <button
                      onClick={handleAddDomain}
                      disabled={isDomainAdding || !customDomain.trim()}
                      className="px-3 py-1.5 text-xs font-medium bg-accent hover:bg-accent-hover text-white rounded-lg transition disabled:opacity-50"
                    >
                      {isDomainAdding ? '...' : t('common.add')}
                    </button>
                  </div>
                )}

                {domainError && (
                  <p className="text-[10px] text-danger mt-1.5">{domainError}</p>
                )}
              </div>
            </div>
          ) : (
            /* Not deployed — subdomain input */
            <div className="space-y-4">
              <p className="text-xs text-muted">
                {t('publish.chooseSubdomain')}
              </p>

              <div>
                <div className="flex items-stretch">
                  <input
                    type="text"
                    value={subdomain}
                    onChange={(e) => {
                      setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''));
                      setError(null);
                    }}
                    placeholder="my-app"
                    className="flex-1 min-w-0 px-3 py-2 bg-surface border border-border rounded-l-lg text-sm text-foreground placeholder:text-subtle focus:outline-none focus:border-accent transition"
                  />
                  <div className="flex items-center px-3 py-2 bg-surface border border-l-0 border-border rounded-r-lg text-xs text-subtle">
                    {t('publish.domainSuffix')}
                  </div>
                </div>
                {subdomain && (
                  <p className="text-[10px] text-subtle mt-1.5">
                    {subdomain}.vibebuild.cc
                  </p>
                )}
              </div>

              <button
                onClick={handleDeploy}
                disabled={isDeploying || !subdomain.trim()}
                className="w-full px-4 py-2.5 text-sm font-medium bg-accent hover:bg-accent-hover text-white rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isDeploying ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    {t('publish.publishing')}
                  </span>
                ) : (
                  t('common.publish')
                )}
              </button>
            </div>
          )}

          {error && (
            <p className="mt-3 text-xs text-danger">{error}</p>
          )}
        </div>
      </div>
    </div>
  );
}
