import { create } from 'zustand';
import type { User, Session } from '@supabase/supabase-js';
import { api } from '@/lib/api';

export interface FairUse {
  dailyGenerations?: { used: number; limit: number; remaining: number; resetsAt: string };
  tweaksPerProject?: { limit: number };
}

export interface SubscriptionStatus {
  tier: string;
  status: string;
  allFree?: boolean;
  fairUse?: FairUse;
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
      const data = await api.get<{ tier: string; status: string; limits?: SubscriptionStatus['limits']; allFree?: boolean; fairUse?: FairUse }>(
        `/api/subscriptions/status?userId=${userId}`
      );
      set({
        subscription: {
          tier: data.tier || 'free',
          status: data.status || 'active',
          limits: data.limits,
          allFree: data.allFree,
          fairUse: data.fairUse,
        },
      });
    } catch {
      // Leave current subscription state unchanged
    }
  },
  clear: () => set({ user: null, session: null, isLoading: false, subscription: null }),
}));
