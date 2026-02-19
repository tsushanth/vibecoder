'use client';

import { useState, useEffect } from 'react';
import { api, ApiError } from '@/lib/api';
import { isValidSubdomain } from '@/lib/utils';
import type { DeployResponse, DeploymentInfoResponse } from '@/types/api';

interface Props {
  projectId: string;
  userId: string;
  onClose: () => void;
  onPublished: (url: string) => void;
}

export function PublishDialog({ projectId, userId, onClose, onPublished }: Props) {
  const [subdomain, setSubdomain] = useState('');
  const [isDeployed, setIsDeployed] = useState(false);
  const [liveUrl, setLiveUrl] = useState<string | null>(null);
  const [deployedAt, setDeployedAt] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeploying, setIsDeploying] = useState(false);
  const [isUndeploying, setIsUndeploying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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
      }
    } catch {
      // Not deployed yet — that's fine
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDeploy() {
    setError(null);
    const trimmed = subdomain.trim().toLowerCase();

    if (!isValidSubdomain(trimmed)) {
      setError('Use 3-62 characters: lowercase letters, numbers, and hyphens.');
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
        setError('Deployment failed. Please try again.');
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
      onPublished('');
    } catch {
      setError('Failed to unpublish.');
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Dialog */}
      <div className="relative w-full max-w-md mx-4 bg-card border border-border rounded-xl shadow-2xl animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold">Publish to Web</h2>
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
                Published
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
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                {deployedAt && (
                  <p className="text-[10px] text-subtle mt-1.5">
                    Deployed {new Date(deployedAt).toLocaleDateString()}
                  </p>
                )}
              </div>

              {/* Update / Unpublish */}
              <div className="flex gap-2">
                <button
                  onClick={handleDeploy}
                  disabled={isDeploying}
                  className="flex-1 px-4 py-2 text-xs font-medium bg-accent hover:bg-accent-hover text-white rounded-lg transition disabled:opacity-50"
                >
                  {isDeploying ? 'Updating...' : 'Update Deployment'}
                </button>
                <button
                  onClick={handleUndeploy}
                  disabled={isUndeploying}
                  className="px-4 py-2 text-xs font-medium text-danger hover:bg-danger/10 border border-danger/30 rounded-lg transition disabled:opacity-50"
                >
                  {isUndeploying ? '...' : 'Unpublish'}
                </button>
              </div>
            </div>
          ) : (
            /* Not deployed — subdomain input */
            <div className="space-y-4">
              <p className="text-xs text-muted">
                Choose a subdomain to publish your app on the web.
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
                    .vibecoder.app
                  </div>
                </div>
                {subdomain && (
                  <p className="text-[10px] text-subtle mt-1.5">
                    {subdomain}.vibecoder.app
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
                    Publishing...
                  </span>
                ) : (
                  'Publish'
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
