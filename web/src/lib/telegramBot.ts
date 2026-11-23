// The VibeBuild Telegram bot. The start payload says where the person came from (the bot records it for attribution).
export const TELEGRAM_BOT_USERNAME = 'Vibebuilder_bot';
export type TelegramSurface = 'web' | 'web_home' | 'web_connect';
export const telegramBotUrl = (payload: TelegramSurface = 'web') => `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${payload}`;
export const telegramLinkUrl = (code: string) => `https://t.me/${TELEGRAM_BOT_USERNAME}?start=link_${encodeURIComponent(code)}`;

// Usage numbers for the Telegram promotion on the website, sent as custom events to Gaugemint (our own cookieless counter, see
// components/landing/MarketingChrome.tsx). Names and the one prop are fixed here; nothing else is ever sent (no ids, no text).
//   "Telegram Section View"  the home page block scrolled into view   { surface: web_home }
//   "Telegram Click"         the person pressed the open-the-bot link  { surface: web_home | web_connect }
// The counter ignores Do Not Track / Global Privacy Control and localhost itself, and the call is a no-op when the script is not
// loaded (ad blocker, other page), so tracking can never break the page.
export const TELEGRAM_VIEW_EVENT = 'Telegram Section View';
export const TELEGRAM_CLICK_EVENT = 'Telegram Click';
type Counter = (name: string, options?: { props?: Record<string, string> }) => void;

export function trackTelegram(event: typeof TELEGRAM_VIEW_EVENT | typeof TELEGRAM_CLICK_EVENT, surface: Exclude<TelegramSurface, 'web'>, counter?: Counter | null): boolean {
  try {
    const send = counter !== undefined ? counter : (typeof window !== 'undefined' ? (window as unknown as { plausible?: Counter }).plausible : undefined);
    if (typeof send !== 'function') return false;
    send(event, { props: { surface } });
    return true;
  } catch {
    return false;
  }
}
