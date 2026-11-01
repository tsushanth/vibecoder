// THE one switch for "VibeBuild is free for now". Default: everything is free (no paywall, no plans, no upgrade prompts).
// To bring the paid plans back: set NEXT_PUBLIC_VIBEBUILD_ALL_FREE=0 at BUILD time (NEXT_PUBLIC_* values are inlined by
// `next build`, so flip it in the web build env / Dockerfile build arg and redeploy), or change this default.
// The Stripe checkout and billing code stays in the tree and is simply unreachable while this is true.
// The backend has its own matching switch (VIBEBUILD_ALL_FREE, default on, '0' restores the old tiers).
export const ALL_FREE: boolean = process.env.NEXT_PUBLIC_VIBEBUILD_ALL_FREE !== '0';

/** The tier the UI should gate on: everyone counts as Pro while all-free is on, the stored tier otherwise. */
export function effectiveTier(tier: string | undefined | null, allFree: boolean = ALL_FREE): string {
  return allFree ? 'pro' : tier || 'free';
}
