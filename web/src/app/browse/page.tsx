'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ExploreList } from '@/components/project/ProjectCard';
import { MarketingHeader, MarketingFooter } from '@/components/landing/MarketingChrome';

// Explore for signed-out visitors: the same list as the app's Explore tab inside the public site chrome.
export default function PublicBrowsePage() {
  const router = useRouter();
  const t = useTranslations('apps.explore');

  return (
    <div className="min-h-screen bg-background text-foreground">
      <MarketingHeader />

      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <header className="pb-6">
          <h1 className="font-display text-4xl font-bold sm:text-5xl">{t('publicTitle')}</h1>
          <p className="mt-3 max-w-[60ch] text-lg text-muted">{t('publicSubtitle')}</p>
        </header>

        <ExploreList
          defaultSort="popular"
          onRemix={() => router.push('/signup')}
          onOpenUnpublished={() => router.push('/signup')}
        />

        <section className="mt-16 flex flex-col items-start justify-between gap-5 border-t border-border pt-10 sm:flex-row sm:items-center">
          <div>
            <h2 className="font-display text-2xl font-semibold">{t('ctaTitle')}</h2>
            <p className="mt-1 max-w-[56ch] text-muted">{t('ctaBody')}</p>
          </div>
          <Link
            href="/signup"
            className="flex h-11 shrink-0 items-center rounded-lg bg-accent px-6 text-[15px] font-semibold text-white transition hover:bg-accent-hover"
          >
            {t('ctaButton')}
          </Link>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}
