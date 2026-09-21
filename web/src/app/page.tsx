import Link from 'next/link';
import { PricingCTA } from '@/components/landing/PricingCTA';
import { PromptHero } from '@/components/landing/PromptHero';
import { BuildPreviewCard } from '@/components/landing/BuildPreviewCard';
import { MarketingHeader, MarketingFooter } from '@/components/landing/MarketingChrome';
import { API_URL, SUBSCRIPTION_TIERS } from '@/lib/constants';

async function getBrowseCount(): Promise<number | null> {
  try {
    const res = await fetch(`${API_URL}/api/projects/browse?limit=1`, { next: { revalidate: 3600 } });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.totalCount === 'number' ? data.totalCount : null;
  } catch {
    return null;
  }
}

const PIPELINE = [
  { n: '1', title: 'Describe', detail: 'Say what you want in plain English, or start from a template.' },
  { n: '2', title: 'Generate', detail: 'A five-phase pipeline writes, checks, and fixes the code — no prompt engineering needed.' },
  { n: '3', title: 'Preview', detail: 'Your app runs live in seconds. Ask for changes the same way you asked for the app.' },
  { n: '4', title: 'Publish', detail: 'One tap gives it a real URL, or your own domain on Pro.' },
];

const FEATURES = [
  { title: 'Chat-style building', detail: 'See the plan before it builds, then keep tweaking in the same thread.' },
  { title: 'Version history', detail: 'Every generation and tweak is saved. Revert to any earlier version.' },
  { title: 'Instant deploys', detail: 'Published apps get a live URL immediately, with your own domain on Pro.' },
  { title: 'Community browse', detail: 'Explore what other people are building, and remix any public app.' },
  { title: 'Android, iOS & web', detail: 'Build from your phone or your laptop. Your projects follow you.' },
];

export default async function LandingPage() {
  const browseCount = await getBrowseCount();

  return (
    <div className="theme-paper min-h-screen bg-[#FAF6F1] text-[#17140F]">
      <MarketingHeader />

      {/* Hero */}
      <section className="px-6 pb-16 pt-20 sm:pt-28">
        <div className="mx-auto max-w-3xl text-center">
          <p className="mb-6 inline-flex items-center gap-2 text-sm text-[#17140F]/62">
            <span className="h-1.5 w-1.5 rounded-full bg-[#5B4CFF]" />
            Free to start &middot; Android, iOS &amp; web
          </p>
          <h1 className="text-5xl font-semibold leading-[1.08] tracking-tight sm:text-6xl">
            Describe an app.
            <br />
            Watch it build.
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-[#17140F]/62">
            One sentence in, a working app out. VibeBuild plans it, builds it, and gives it a
            live link you can share — usually in under a minute.
          </p>
        </div>

        <div className="mt-10">
          <PromptHero />
        </div>
      </section>

      {/* Product mockup */}
      <section className="px-6 pb-20">
        <div className="mx-auto max-w-3xl">
          <BuildPreviewCard />
        </div>
      </section>

      {/* Stats */}
      <section className="border-y border-[#17140F]/12 bg-white px-6 py-8">
        <div className="mx-auto flex max-w-4xl flex-col items-center justify-center gap-3 text-center text-sm text-[#17140F]/62 sm:flex-row sm:gap-10">
          <span><strong className="font-semibold text-[#17140F]">800+</strong> people building</span>
          <span className="hidden text-[#17140F]/20 sm:inline">&middot;</span>
          <span>
            <strong className="font-semibold text-[#17140F]">{browseCount ? browseCount.toLocaleString() : '1,400+'}</strong> apps you can browse and remix
          </span>
          <span className="hidden text-[#17140F]/20 sm:inline">&middot;</span>
          <span><strong className="font-semibold text-[#17140F]">3</strong> platforms, one account</span>
        </div>
      </section>

      {/* Pipeline */}
      <section className="px-6 py-24">
        <div className="mx-auto max-w-4xl">
          <div className="max-w-lg">
            <h2 className="text-3xl font-semibold tracking-tight">From idea to live app</h2>
            <p className="mt-3 text-[#17140F]/62">No setup, no separate hosting to configure, no code to read unless you want to.</p>
          </div>
          <ol className="mt-12 space-y-8">
            {PIPELINE.map((step) => (
              <li key={step.n} className="flex gap-5 border-t border-[#17140F]/12 pt-6 first:border-t-0 first:pt-0 sm:gap-8">
                <span className="font-mono text-sm text-[#17140F]/40">{step.n}</span>
                <div>
                  <h3 className="text-lg font-semibold">{step.title}</h3>
                  <p className="mt-1 max-w-md text-[#17140F]/62">{step.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Features */}
      <section className="border-t border-[#17140F]/12 px-6 py-24">
        <div className="mx-auto max-w-4xl">
          <h2 className="text-3xl font-semibold tracking-tight">Everything you need to ship it</h2>
          <div className="mt-12 grid grid-cols-1 gap-x-12 gap-y-10 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <div key={f.title}>
                <h3 className="text-base font-semibold">{f.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-[#17140F]/62">{f.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="border-t border-[#17140F]/12 px-6 py-24">
        <div className="mx-auto max-w-4xl">
          <h2 className="text-3xl font-semibold tracking-tight">Simple pricing</h2>
          <p className="mt-3 max-w-md text-[#17140F]/62">Start free. Upgrade when the ten-a-day limit is the only thing slowing you down.</p>

          <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div className="rounded-2xl border border-[#17140F]/12 bg-white p-7">
              <h3 className="text-lg font-semibold">{SUBSCRIPTION_TIERS.free.name}</h3>
              <div className="mt-2 mb-6 flex items-baseline gap-1">
                <span className="text-3xl font-semibold">$0</span>
                <span className="text-sm text-[#17140F]/62">forever</span>
              </div>
              <ul className="mb-8 space-y-3 text-sm text-[#17140F]/62">
                <li>10 generations a day</li>
                <li>3 tweaks per project</li>
                <li>Public projects</li>
                <li>One-click deploy</li>
                <li>Browse and remix the community</li>
              </ul>
              <PricingCTA tier="free" label="Start free" highlighted={false} />
            </div>

            <div className="relative rounded-2xl border border-[#5B4CFF] bg-white p-7">
              <span className="absolute -top-3 left-7 rounded-full bg-[#5B4CFF] px-3 py-1 text-xs font-semibold text-white">
                Most popular
              </span>
              <h3 className="text-lg font-semibold">{SUBSCRIPTION_TIERS.pro.name}</h3>
              <div className="mt-2 mb-6 flex items-baseline gap-1">
                <span className="text-3xl font-semibold">$9.99</span>
                <span className="text-sm text-[#17140F]/62">/month</span>
              </div>
              <ul className="mb-8 space-y-3 text-sm text-[#17140F]/62">
                <li>Unlimited generations</li>
                <li>Unlimited tweaks</li>
                <li>Private projects</li>
                <li>Your own domain</li>
                <li>Priority build queue</li>
              </ul>
              <PricingCTA tier="pro" label="Upgrade to Pro" highlighted={true} />
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="border-t border-[#17140F]/12 px-6 py-24">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">What are you going to build?</h2>
          <p className="mt-3 text-[#17140F]/62">No credit card, no setup. Just describe it.</p>
          <Link
            href="/signup"
            className="mt-8 inline-block rounded-full bg-[#5B4CFF] px-8 py-3.5 text-lg font-semibold text-white transition hover:bg-[#4638D6]"
          >
            Start building free
          </Link>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
