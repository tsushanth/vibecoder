// The welcome screen is shown once. Browser storage can be missing or throw (private windows, blocked site data), so every
// access is guarded and a failure just means the person may see the welcome screen again.
export const ONBOARDED_KEY = 'vb_onboarded';

export function hasOnboarded(): boolean {
  try {
    return window.localStorage.getItem(ONBOARDED_KEY) === '1';
  } catch {
    return false;
  }
}

export function markOnboarded(): void {
  try {
    window.localStorage.setItem(ONBOARDED_KEY, '1');
  } catch {
    // nothing to do: the screen simply shows again next time
  }
}

/** Where the welcome screen hands off: subscribers skip the upgrade screen, as on Android. */
export function afterWelcome(tier: string | undefined | null): string {
  return tier && tier !== 'free' ? '/project/new' : '/upgrade';
}
