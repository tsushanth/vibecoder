import { PLAY_STORE_URL, IOS_APP_STORE_URL } from '@/lib/storeLinks';

/**
 * "Get the app" row for the landing page: Google Play always, the App Store only once IOS_APP_STORE_URL is set.
 * The badge image carries width and height, so the row reserves its space before the image loads (no layout shift).
 */
export function StoreBadges() {
  return (
    <div className="mt-8">
      <p className="text-sm text-muted">Also on your phone</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-1 gap-y-0">
        {/* The PNG is Google's own badge artwork, unmodified; it has built-in clear space, so the visible badge is about 42px tall. */}
        <a
          href={PLAY_STORE_URL}
          target="_blank"
          rel="noopener"
          className="-ml-[10px] block rounded-lg focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent"
        >
          <img src="/badges/google-play-badge.png" alt="Get VibeBuild on Google Play" width={646} height={250} className="h-16 w-auto" />
        </a>
        {IOS_APP_STORE_URL ? (
          <a
            href={IOS_APP_STORE_URL}
            target="_blank"
            rel="noopener"
            aria-label="Download VibeBuild on the App Store"
            className="flex h-[42px] items-center rounded-lg border border-white/30 bg-black px-4 text-left text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <span className="block leading-tight">
              <span className="block text-[10px]">Download on the</span>
              <span className="block text-lg font-semibold">App Store</span>
            </span>
          </a>
        ) : null}
      </div>
    </div>
  );
}
