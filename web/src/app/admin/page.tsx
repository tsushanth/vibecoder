'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase';
import AdminDashboard from '@/components/AdminDashboard';

// The gate is /api/admin/overview (404 unless the token is the allowlisted Google account).
export default function AdminPage() {
  const [token, setToken] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => setToken(data.session?.access_token ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setToken(s?.access_token ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (token === undefined) return null;
  if (!token) {
    return (
      <p style={{ padding: 24 }}>
        Sign in with Google on <Link href="/login" style={{ textDecoration: 'underline' }}>/login</Link>, then open /admin again.
      </p>
    );
  }
  return <AdminDashboard token={token} />;
}
