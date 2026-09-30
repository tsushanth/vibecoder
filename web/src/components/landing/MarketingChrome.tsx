import Link from 'next/link';

// Palette (see the note in globals.css on why these are literal, not the
// app's semantic bg-background/text-muted/etc. classes): paper #FAF6F1,
// ink #17140F, accent #5B4CFF / hover #4638D6.

export function MarketingHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-[#17140F]/12 bg-[#FAF6F1]/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight text-[#17140F]">
          <img src="/favicon-32x32.png" alt="" className="h-7 w-7 rounded-lg" />
          VibeBuild
        </Link>
        <nav className="flex items-center gap-7">
          <Link href="/browse" className="hidden text-sm text-[#17140F]/62 transition hover:text-[#17140F] sm:inline">
            Browse
          </Link>
          <Link href="/#pricing" className="hidden text-sm text-[#17140F]/62 transition hover:text-[#17140F] sm:inline">
            Pricing
          </Link>
          <Link href="/blog" className="hidden text-sm text-[#17140F]/62 transition hover:text-[#17140F] sm:inline">
            Blog
          </Link>
          <Link href="/login" className="text-sm text-[#17140F]/62 transition hover:text-[#17140F]">
            Sign in
          </Link>
          <Link
            href="/signup"
            className="rounded-full bg-[#5B4CFF] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#4638D6]"
          >
            Get started
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="border-t border-[#17140F]/12 px-6 py-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <Link href="/" className="flex items-center gap-2 text-sm font-semibold text-[#17140F]">
          <img src="/favicon-32x32.png" alt="" className="h-5 w-5 rounded" />
          VibeBuild
        </Link>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-[#17140F]/62">
          <Link href="/browse" className="transition hover:text-[#17140F]">Browse</Link>
          <Link href="/blog" className="transition hover:text-[#17140F]">Blog</Link>
          <Link href="/about" className="transition hover:text-[#17140F]">About</Link>
          <Link href="/faq" className="transition hover:text-[#17140F]">FAQ</Link>
          <Link href="/sms" className="transition hover:text-[#17140F]">Text to Build</Link>
          <Link href="/terms" className="transition hover:text-[#17140F]">Terms</Link>
          <Link href="/privacy" className="transition hover:text-[#17140F]">Privacy</Link>
          <Link href="/login" className="transition hover:text-[#17140F]">Sign in</Link>
        </div>
        <p className="text-sm text-[#17140F]/40">
          Built by a two-person team &middot; &copy; {new Date().getFullYear()} VibeBuild
        </p>
      </div>
    </footer>
  );
}
