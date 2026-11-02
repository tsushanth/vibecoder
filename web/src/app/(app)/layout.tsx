'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';
import { Sidebar, BottomTabs } from '@/components/layout/Sidebar';
import { StatusBanner } from '@/components/layout/StatusBanner';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/login');
    }
  }, [user, isLoading, router]);

  if (isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar />
      {/* the bottom padding keeps the last row clear of the phone tab bar */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <StatusBanner />
        <main className="min-h-0 flex-1 overflow-auto pb-16 md:pb-0">{children}</main>
      </div>
      <BottomTabs />
    </div>
  );
}
