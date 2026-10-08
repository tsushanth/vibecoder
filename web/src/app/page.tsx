import Link from 'next/link';
import { PricingCTA } from '@/components/landing/PricingCTA';
import { HeroComposer } from '@/components/landing/HeroComposer';
import { LiveBuild } from '@/components/landing/LiveBuild';
import { MobileCtaBar } from '@/components/landing/MobileCtaBar';
import { MarketingHeader, MarketingFooter } from '@/components/landing/MarketingChrome';
import { SUBSCRIPTION_TIERS } from '@/lib/constants';

const STEPS = [
  { title: 'Describe', detail: 'Say what you want in plain English, or start from an idea.' },
  { title: 'Generate', detail: 'VibeBuild plans the app, writes it, and checks that it runs.' },
  { title: 'Preview', detail: 'Your app opens live in seconds. Ask for changes the way you asked for the app.' },
  { title: 'Publish', detail: 'One tap gives it a web address you can share.' },
];

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <MarketingHeader />

      <main>
        <section className="px-5 pb-20 pt-12 sm:px-6 lg:pb-28 lg:pt-20">
          <div className="mx-auto grid max-w-6xl items-center gap-14 lg:grid-cols-[1.15fr_0.85fr] lg:gap-10">
            <div>
              <h1 className="font-display text-[clamp(2.6rem,6.2vw,4.9rem)] font-bold leading-[1.02]">
                Describe an app.
                <br />
                Watch it build.
              </h1>
              <p className="mt-6 max-w-[34rem] text-lg leading-relaxed text-muted">
                One sentence in, a working app out. VibeBuild plans it, builds it, and gives it a live link you can share.
              </p>
              <div className="mt-9">
                <HeroComposer />
              </div>
            </div>
            <LiveBuild />
          </div>
        </section>

        <section className="border-t border-border px-5 py-20 sm:px-6">
          <div className="mx-auto max-w-6xl">
            <h2 className="font-display text-3xl font-bold sm:text-4xl">From idea to live app</h2>
            <ol className="mt-12 grid gap-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
              {STEPS.map((s, i) => (
                <li key={s.title} className="relative lg:pr-6">
                  <span className="font-display text-5xl font-bold text-accent-hover/70">{i + 1}</span>
                  <h3 className="mt-3 font-display text-xl font-semibold">{s.title}</h3>
                  <p className="mt-1.5 max-w-[16rem] text-[15px] leading-relaxed text-muted">{s.detail}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="pricing" className="scroll-mt-16 border-t border-border px-5 py-20 sm:px-6">
          <div className="mx-auto max-w-6xl">
            <h2 className="font-display text-3xl font-bold sm:text-4xl">Start free, upgrade when you need more</h2>
            <div className="mt-12 grid gap-12 md:grid-cols-2 md:gap-0 md:divide-x md:divide-border">
              <div className="flex flex-col md:pr-12">
                <h3 className="font-display text-xl font-semibold">{SUBSCRIPTION_TIERS.free.name}</h3>
                <p className="mt-3 flex items-baseline gap-1.5"><span className="font-display text-5xl font-bold">$0</span><span className="text-muted">forever</span></p>
                <ul className="mb-8 mt-6 flex-1 space-y-2.5 text-[15px] text-muted">
                  <li>Build and publish apps</li>
                  <li>3 tweaks per project</li>
                  <li>Public projects</li>
                  <li>Explore and remix what others built</li>
                </ul>
                <PricingCTA tier="free" label="Start free" highlighted={false} />
              </div>
              <div className="flex flex-col md:pl-12">
                <h3 className="font-display text-xl font-semibold">{SUBSCRIPTION_TIERS.pro.name}</h3>
                <p className="mt-3 flex items-baseline gap-1.5"><span className="font-display text-5xl font-bold">$9.99</span><span className="text-muted">a month</span></p>
                <ul className="mb-8 mt-6 flex-1 space-y-2.5 text-[15px] text-muted">
                  <li>Unlimited generations and tweaks</li>
                  <li>Private projects</li>
                  <li>Your own domain</li>
                </ul>
                <PricingCTA tier="pro" label="Upgrade to Pro" highlighted />
              </div>
            </div>
          </div>
        </section>

        <section className="border-t border-border px-5 py-24 sm:px-6">
          <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="font-display text-3xl font-bold sm:text-4xl">What will you build?</h2>
            <Link href="/signup" className="rounded-lg bg-accent px-7 py-3.5 text-base font-semibold text-white transition hover:bg-accent-hover">Start building free</Link>
          </div>
        </section>
      </main>

      <MarketingFooter />
      <MobileCtaBar />
    </div>
  );
}
