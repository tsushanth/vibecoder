import { SUPPORTED_LOCALES, type SupportedLocale } from './locales.ts';

/**
 * Chinese is three locales here: 'zh' (Simplified, also CN/SG/Hans and a bare "zh"), 'zh-TW' (Traditional: TW, MO, Hant)
 * and 'zh-HK' (Traditional, Hong Kong). The Hans script wins over a region (zh-Hans-HK is Simplified).
 */
function chineseLocale(subtags: string[]): SupportedLocale {
  if (subtags.includes('hans')) return 'zh';
  if (subtags.includes('hk')) return 'zh-HK';
  if (subtags.includes('hant') || subtags.includes('tw') || subtags.includes('mo')) return 'zh-TW';
  return 'zh';
}

/** One language tag (an Accept-Language entry, "pt-BR", "zh-Hant-TW") to a supported locale, or null. */
export function localeFromTag(tag: string): SupportedLocale | null {
  const [primary, ...rest] = tag.trim().toLowerCase().split(/[-_]/);
  const candidate = primary === 'zh' ? chineseLocale(rest) : primary;
  return (SUPPORTED_LOCALES as readonly string[]).includes(candidate) ? (candidate as SupportedLocale) : null;
}

/** The best supported locale of an Accept-Language header (highest q first), or null. */
export function localeFromAcceptLanguage(header: string): SupportedLocale | null {
  const langs = header
    .split(',')
    .map((part) => {
      const [lang, q] = part.trim().split(';q=');
      return { lang, q: q ? parseFloat(q) : 1 };
    })
    .sort((a, b) => b.q - a.q);
  for (const { lang } of langs) {
    const found = localeFromTag(lang);
    if (found) return found;
  }
  return null;
}
