import Link from 'next/link';

// Header and footer of the public pages (landing, about, faq, blog, browse, legal). Same palette and logo as the app.

export function MarketingHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 px-5 backdrop-blur-md sm:px-6">
      <div className="mx-auto flex max-w-6xl items-center justify-between py-3.5">
        <Link href="/" className="flex items-center gap-2.5 font-display text-[19px] font-semibold text-foreground">
          <img src="/favicon-32x32.png" alt="" className="h-7 w-7 rounded-lg" />
          VibeBuild
        </Link>
        <nav className="flex items-center gap-6" aria-label="Main">
          <Link href="/browse" className="hidden text-sm text-muted transition hover:text-foreground sm:inline">Explore</Link>
          <Link href="/#pricing" className="hidden text-sm text-muted transition hover:text-foreground sm:inline">Pricing</Link>
          <Link href="/blog" className="hidden text-sm text-muted transition hover:text-foreground sm:inline">Blog</Link>
          <Link href="/login" className="text-sm text-muted transition hover:text-foreground">Sign in</Link>
          <Link href="/signup" className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-hover">
            Get started
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="border-t border-border px-5 pb-28 pt-10 sm:px-6 md:pb-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <Link href="/" className="flex items-center gap-2 font-display text-base font-semibold text-foreground">
          <img src="/favicon-32x32.png" alt="" className="h-5 w-5 rounded" />
          VibeBuild
        </Link>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted">
          <Link href="/browse" className="transition hover:text-foreground">Explore</Link>
          <Link href="/blog" className="transition hover:text-foreground">Blog</Link>
          <Link href="/about" className="transition hover:text-foreground">About</Link>
          <Link href="/faq" className="transition hover:text-foreground">FAQ</Link>
          <Link href="/sms" className="transition hover:text-foreground">Text to build</Link>
          <Link href="/terms" className="transition hover:text-foreground">Terms</Link>
          <Link href="/privacy" className="transition hover:text-foreground">Privacy</Link>
        </div>
        <p className="text-sm text-subtle">&copy; {new Date().getFullYear()} VibeBuild</p>
      </div>
    </footer>
  );
}
