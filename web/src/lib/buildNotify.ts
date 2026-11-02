/** Helpers for "notify me when the build is done" (browser Notification API plus the tab title; no service worker, no push). */

export type NotificationState = 'unsupported' | 'default' | 'granted' | 'denied';

/** The permission state of the given window-like object, or 'unsupported' when it has no Notification API. */
export function notificationState(win: { Notification?: { permission?: string } } | undefined): NotificationState {
  const p = win?.Notification?.permission;
  return p === 'default' || p === 'granted' || p === 'denied' ? p : 'unsupported';
}

/** Show a system notification only if the person asked for one, the browser allows it, and they are not looking at the tab. */
export function shouldFireNotification(o: { armed: boolean; permission: NotificationState; hidden: boolean }): boolean {
  return o.armed && o.permission === 'granted' && o.hidden;
}

/** "(App ready) VibeBuild": a hint in the tab title while the tab is in the background. */
export function flaggedTitle(title: string, label: string): string {
  const prefix = `(${label}) `;
  return title.startsWith(prefix) ? title : prefix + title;
}

export function unflaggedTitle(title: string, label: string): string {
  const prefix = `(${label}) `;
  return title.startsWith(prefix) ? title.slice(prefix.length) : title;
}
