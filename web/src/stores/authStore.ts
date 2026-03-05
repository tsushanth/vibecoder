import { create } from 'zustand';
import type { User, Session } from '@supabase/supabase-js';

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
  clear: () => set({ user: null, session: null, isLoading: false, subscription: null }),
}));
