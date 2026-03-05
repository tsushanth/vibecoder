'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';
import { createClient } from '@/lib/supabase';
import { SUBSCRIPTION_TIERS } from '@/lib/constants';

export default function SettingsPage() {
  const { user, subscription } = useAuthStore();
  const router = useRouter();
  const [showUpgrade, setShowUpgrade] = useState(false);

  const currentTier = subscription?.tier || 'free';
  const tierInfo = SUBSCRIPTION_TIERS[currentTier as keyof typeof SUBSCRIPTION_TIERS] || SUBSCRIPTION_TIERS.free;

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/');
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-8">Settings</h1>

      {/* Profile */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4">Profile</h2>
        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-accent/20 flex items-center justify-center text-lg font-bold text-accent">
              {user?.email?.[0]?.toUpperCase() || '?'}
            </div>
            <div>
              <p className="font-medium">
                {user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'User'}
              </p>
              <p className="text-sm text-muted">{user?.email}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Subscription */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4">Subscription</h2>
        <div className="bg-card border border-border rounded-xl p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <p className="font-medium">{tierInfo.name} Plan</p>
                {currentTier !== 'free' && (
                  <span className="px-2 py-0.5 bg-accent/20 text-accent text-xs rounded-full font-medium">
                    Active
                  </span>
                )}
              </div>
              <p className="text-sm text-muted mt-1">
                {tierInfo.dailyGenerations === Infinity ? 'Unlimited' : tierInfo.dailyGenerations} generations/day,{' '}
                {tierInfo.tweaksPerProject === Infinity ? 'Unlimited' : tierInfo.tweaksPerProject} tweaks/project
              </p>
            </div>
            {currentTier === 'free' && (
              <button
                onClick={() => setShowUpgrade(true)}
                className="px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-semibold rounded-xl transition"
              >
                Upgrade to Pro
              </button>
            )}
          </div>

          {/* Usage stats */}
          {subscription?.limits && (
            <div className="pt-3 border-t border-border">
              <p className="text-xs text-muted mb-2">Current Usage</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-surface rounded-lg p-3">
                  <p className="text-xs text-muted">Daily Generations</p>
                  <p className="text-sm font-semibold">
                    {typeof subscription.limits.dailyGenerations === 'number'
                      ? `${subscription.limits.dailyGenerations} / day`
                      : subscription.limits.dailyGenerations}
                  </p>
                </div>
                <div className="bg-surface rounded-lg p-3">
                  <p className="text-xs text-muted">Tweaks / Project</p>
                  <p className="text-sm font-semibold">
                    {typeof subscription.limits.tweaksPerProject === 'number'
                      ? `${subscription.limits.tweaksPerProject} / project`
                      : subscription.limits.tweaksPerProject}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Features list for current plan */}
          <div className="pt-3 border-t border-border">
            <p className="text-xs text-muted mb-2">Your Plan Includes</p>
            <ul className="space-y-1.5">
              <li className="flex items-center gap-2 text-sm text-muted">
                <svg className="w-4 h-4 text-success shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                {tierInfo.dailyGenerations === Infinity ? 'Unlimited' : tierInfo.dailyGenerations} generations per day
              </li>
              <li className="flex items-center gap-2 text-sm text-muted">
                <svg className="w-4 h-4 text-success shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                {tierInfo.tweaksPerProject === Infinity ? 'Unlimited' : tierInfo.tweaksPerProject} tweaks per project
              </li>
              <li className="flex items-center gap-2 text-sm text-muted">
                <svg className={`w-4 h-4 shrink-0 ${tierInfo.canCreatePrivateProjects ? 'text-success' : 'text-subtle'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={tierInfo.canCreatePrivateProjects ? "M5 13l4 4L19 7" : "M6 18L18 6M6 6l12 12"} />
                </svg>
                {tierInfo.canCreatePrivateProjects ? 'Private projects' : 'Public projects only'}
              </li>
              {currentTier !== 'free' && (
                <>
                  <li className="flex items-center gap-2 text-sm text-muted">
                    <svg className="w-4 h-4 text-success shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Custom domains
                  </li>
                  <li className="flex items-center gap-2 text-sm text-muted">
                    <svg className="w-4 h-4 text-success shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Priority generation queue
                  </li>
                </>
              )}
            </ul>
          </div>
        </div>
      </section>

      {/* Upgrade Dialog */}
      {showUpgrade && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowUpgrade(false)}>
          <div className="bg-card border border-border rounded-2xl p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-xl font-bold mb-2">Upgrade to Pro</h3>
            <p className="text-sm text-muted mb-6">Unlock unlimited generations, tweaks, private projects, and custom domains.</p>

            <div className="bg-surface border border-border rounded-xl p-4 mb-6">
              <div className="flex items-baseline gap-1 mb-3">
                <span className="text-3xl font-bold">$9.99</span>
                <span className="text-sm text-muted">/month</span>
              </div>
              <ul className="space-y-2">
                {['Unlimited generations', 'Unlimited tweaks', 'Private projects', 'Custom domains', 'Priority queue'].map((feat) => (
                  <li key={feat} className="flex items-center gap-2 text-sm text-muted">
                    <svg className="w-4 h-4 text-success shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    {feat}
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowUpgrade(false)}
                className="flex-1 px-4 py-2.5 border border-border hover:bg-surface rounded-xl text-sm font-medium transition"
              >
                Maybe Later
              </button>
              <button
                onClick={() => {
                  // Open subscription page on mobile app or redirect to app store
                  // For now, show pricing page
                  setShowUpgrade(false);
                  window.open('https://apps.apple.com/app/vibebuild/id6745172798', '_blank');
                }}
                className="flex-1 px-4 py-2.5 bg-accent hover:bg-accent-hover text-white rounded-xl text-sm font-semibold transition"
              >
                Subscribe via App
              </button>
            </div>

            <p className="text-xs text-subtle mt-3 text-center">
              Subscriptions are managed via the iOS or Android app through Apple/Google.
            </p>
          </div>
        </div>
      )}

      {/* Sign Out */}
      <section>
        <button
          onClick={handleSignOut}
          className="px-4 py-2 bg-danger/10 hover:bg-danger/20 text-danger text-sm font-medium rounded-xl transition"
        >
          Sign Out
        </button>
      </section>
    </div>
  );
}
