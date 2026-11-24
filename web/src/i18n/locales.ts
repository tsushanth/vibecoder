export const SUPPORTED_LOCALES = [
  'en', 'es', 'fr', 'de', 'ja', 'zh', 'zh-TW', 'zh-HK', 'ko', 'pt', 'it', 'hi',
] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
