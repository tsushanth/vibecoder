// The VibeBuild Telegram bot. The start payload says where the person came from (the bot records it for attribution).
export const TELEGRAM_BOT_USERNAME = 'Vibebuilder_bot';
export const telegramBotUrl = (payload: 'web' | 'web_home' | 'web_connect' = 'web') => `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${payload}`;
export const telegramLinkUrl = (code: string) => `https://t.me/${TELEGRAM_BOT_USERNAME}?start=link_${encodeURIComponent(code)}`;
