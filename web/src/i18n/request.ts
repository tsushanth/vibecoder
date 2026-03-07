import { getRequestConfig } from 'next-intl/server';
import { cookies, headers } from 'next/headers';
import { SUPPORTED_LOCALES, type SupportedLocale } from './locales';

function parseAcceptLanguage(header: string): string | null {
  const langs = header
    .split(',')
    .map((part) => {
      const [lang, q] = part.trim().split(';q=');
      return { lang: lang.split('-')[0].toLowerCase(), q: q ? parseFloat(q) : 1 };
    })
    .sort((a, b) => b.q - a.q);

  for (const { lang } of langs) {
    if (SUPPORTED_LOCALES.includes(lang as SupportedLocale)) {
      return lang;
    }
  }
  return null;
}

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const headerStore = await headers();

  let locale = cookieStore.get('locale')?.value;

  if (!locale || !SUPPORTED_LOCALES.includes(locale as SupportedLocale)) {
    const acceptLang = headerStore.get('accept-language');
    if (acceptLang) {
      locale = parseAcceptLanguage(acceptLang) ?? 'en';
    } else {
      locale = 'en';
    }
  }

  return {
    locale,
    messages: (await import(`./messages/${locale}.json`)).default,
  };
});
