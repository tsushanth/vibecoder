import { create } from 'zustand';
import type { User, Session } from '@supabase/supabase-js';
import { api } from '@/lib/api';

interface SubscriptionStatus {
  tier: string;
  status: string;
  limits?: {
    dailyGenerations: number | string;
    tweaksPerProject: number | string;
    canCreatePrivateProjects: boolean;
  };
}

interface AuthState {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  subscription: SubscriptionStatus | null;
  setUser: (user: User | null) => void;
  setSession: (session: Session | null) => void;
  setLoading: (loading: boolean) => void;
  setSubscription: (sub: SubscriptionStatus | null) => void;
  refreshSubscription: (userId: string) => Promise<void>;
  clear: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  session: null,
  isLoading: true,
  subscription: null,
  setUser: (user) => set({ user }),
  setSession: (session) => set({ session, user: session?.user ?? null }),
  setLoading: (isLoading) => set({ isLoading }),
  setSubscription: (subscription) => set({ subscription }),
  refreshSubscription: async (userId: string) => {
    try {
      const data = await api.get<{ tier: string; status: string; limits?: SubscriptionStatus['limits'] }>(
        `/api/subscriptions/status?userId=${userId}`
      );
      set({
        subscription: {
          tier: data.tier || 'free',
          status: data.status || 'active',
          limits: data.limits,
        },
      });
    } catch {
      // Leave current subscription state unchanged
    }
  },
  clear: () => set({ user: null, session: null, isLoading: false, subscription: null }),
}));
