export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  'https://vibecoder-api.fly.dev';

export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://owvvrljdfnhntwedepkl.supabase.co';

export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export const SUBSCRIPTION_TIERS = {
  free: {
    name: 'Free',
    price: '$0',
    dailyGenerations: 3,
    tweaksPerProject: 3,
    canCreatePrivateProjects: false,
  },
  pro: {
    name: 'Pro',
    price: '$9.99/mo',
    dailyGenerations: Infinity,
    tweaksPerProject: Infinity,
    canCreatePrivateProjects: true,
  },
  team: {
    name: 'Team',
    price: '$29.99/mo',
    dailyGenerations: Infinity,
    tweaksPerProject: Infinity,
    canCreatePrivateProjects: true,
  },
} as const;

export const GENERATION_PHASES = [
  'generating',
  'validating',
  'fixing',
  'polishing',
  'verifying',
] as const;

export const PHASE_LABELS: Record<string, string> = {
  generating: 'Generating',
  validating: 'Validating',
  fixing: 'Fixing Issues',
  polishing: 'Polishing',
  verifying: 'Verifying',
};
