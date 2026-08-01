import Link from 'next/link';

export function ContentHeader() {
  return (
    <header className="border-b border-border/50 backdrop-blur-md sticky top-0 z-40 bg-background/80">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 text-lg font-bold">
          <img src="/favicon-32x32.png" alt="VibeBuild" className="w-7 h-7 rounded-lg" />
          <span>VibeBuild</span>
        </Link>
        <nav className="flex items-center gap-6">
          <Link href="/browse" className="text-sm text-muted hover:text-foreground transition">
            Browse
          </Link>
          <Link href="/blog" className="text-sm text-muted hover:text-foreground transition">
            Blog
          </Link>
          <Link href="/login" className="text-sm text-muted hover:text-foreground transition">
            Sign In
          </Link>
          <Link
            href="/signup"
            className="px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-semibold rounded-xl transition"
          >
            Get Started
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function ContentFooter() {
  return (
    <footer className="border-t border-border py-8 px-6">
      <div className="max-w-6xl mx-auto flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-2 text-sm text-muted">
          <img src="/favicon-32x32.png" alt="VibeBuild" className="w-5 h-5 rounded" />
          <span>VibeBuild</span>
        </div>
        <div className="flex items-center gap-6 text-xs text-subtle">
          <Link href="/browse" className="hover:text-foreground transition">Browse</Link>
          <Link href="/blog" className="hover:text-foreground transition">Blog</Link>
          <Link href="/about" className="hover:text-foreground transition">About</Link>
          <Link href="/faq" className="hover:text-foreground transition">FAQ</Link>
          <Link href="/terms" className="hover:text-foreground transition">Terms</Link>
          <Link href="/privacy" className="hover:text-foreground transition">Privacy</Link>
        </div>
        <p className="text-xs text-subtle">
          &copy; {new Date().getFullYear()} VibeBuild. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
