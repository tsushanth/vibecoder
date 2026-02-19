'use client';

import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';
import { createClient } from '@/lib/supabase';

export default function SettingsPage() {
  const { user } = useAuthStore();
  const router = useRouter();

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
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Free Plan</p>
              <p className="text-sm text-muted">3 generations per day, 3 tweaks per project</p>
            </div>
            <button className="px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-semibold rounded-xl transition">
              Upgrade to Pro
            </button>
          </div>
        </div>
      </section>

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
