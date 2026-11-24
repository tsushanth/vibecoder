import { getRequestConfig } from 'next-intl/server';
import { cookies, headers } from 'next/headers';
import { SUPPORTED_LOCALES, type SupportedLocale } from './locales';
import { localeFromAcceptLanguage } from './match';

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const headerStore = await headers();

  let locale = cookieStore.get('locale')?.value;

  if (!locale || !SUPPORTED_LOCALES.includes(locale as SupportedLocale)) {
    const acceptLang = headerStore.get('accept-language');
    if (acceptLang) {
      locale = localeFromAcceptLanguage(acceptLang) ?? 'en';
    } else {
      locale = 'en';
    }
  }

  return { locale, messages: await loadMessages(locale) };
});

// Each area of the app keeps its new copy in its own file (messages/parts/<part>.<locale>.json) so several people can add strings
// without editing the same JSON. Anything missing in a language falls back to English, so a half-translated key never shows as a raw key.
const PARTS = ['landing', 'auth', 'create', 'apps', 'account'] as const;
type Messages = Record<string, unknown>;

function deepMerge(base: Messages, over: Messages): Messages {
  const out: Messages = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = out[k];
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && b && typeof b === 'object' ? deepMerge(b as Messages, v as Messages) : v;
  }
  return out;
}

async function loadFor(locale: string): Promise<Messages> {
  let merged: Messages = (await import(`./messages/${locale}.json`)).default;
  for (const part of PARTS) {
    const extra = (await import(`./messages/parts/${part}.${locale}.json`)).default as Messages;
    merged = deepMerge(merged, extra);
  }
  return merged;
}

async function loadMessages(locale: string): Promise<Messages> {
  const localized = await loadFor(locale);
  return locale === 'en' ? localized : deepMerge(await loadFor('en'), localized);
}
