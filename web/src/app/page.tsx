import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { PricingCTA } from '@/components/landing/PricingCTA';

export default function LandingPage() {
  const t = useTranslations();

  const steps = [
    { num: '1', title: t('landing.stepDescribe'), description: t('landing.stepDescribeDetail') },
    { num: '2', title: t('landing.stepGenerate'), description: t('landing.stepGenerateDetail') },
    { num: '3', title: t('landing.stepIterate'), description: t('landing.stepIterateDetail') },
    { num: '4', title: t('landing.stepPublish'), description: t('landing.stepPublishDetail') },
  ];

  const features = [
    {
      title: t('landing.featurePipeline'),
      description: t('landing.featurePipelineDetail'),
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      ),
    },
    {
      title: t('landing.featurePreview'),
      description: t('landing.featurePreviewDetail'),
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
        </svg>
      ),
    },
    {
      title: t('landing.featureVersions'),
      description: t('landing.featureVersionsDetail'),
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      title: t('landing.featureDeploy'),
      description: t('landing.featureDeployDetail'),
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
        </svg>
      ),
    },
    {
      title: t('landing.featureCommunity'),
      description: t('landing.featureCommunityDetail'),
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
    },
    {
      title: t('landing.featureCrossPlatform'),
      description: t('landing.featureCrossPlatformDetail'),
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
      ),
    },
  ];

  const freePlanFeatures = [
    t('landing.planFreeGen'), t('landing.planFreeTweaks'), t('landing.planFreePublic'),
    t('landing.planFreeDeploy'), t('landing.planFreeBrowse'),
  ];

  const proPlanFeatures = [
    t('landing.planProGen'), t('landing.planProTweaks'), t('landing.planProPrivate'),
    t('landing.planProDomains'), t('landing.planProPriority'), t('landing.planProNoExpiry'),
  ];

  const pricingPlans = [
    {
      name: t('landing.planFree'), price: '$0', period: t('landing.planFreePeriod'),
      features: freePlanFeatures, cta: t('landing.startFree'), ctaLink: '/signup', highlighted: false,
    },
    {
      name: t('landing.planPro'), price: '$9.99', period: t('landing.planProPeriod'),
      features: proPlanFeatures, cta: t('landing.upgradeToPro'), ctaLink: '/signup', highlighted: true,
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 backdrop-blur-md sticky top-0 z-40 bg-background/80">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-lg font-bold">
            <img src="/favicon-32x32.png" alt="VibeBuild" className="w-7 h-7 rounded-lg" />
            <span>{t('common.vibebuild')}</span>
          </div>
          <nav className="flex items-center gap-6">
            <Link href="/browse" className="text-sm text-muted hover:text-foreground transition">
              {t('common.browse')}
            </Link>
            <Link href="/blog" className="text-sm text-muted hover:text-foreground transition">
              Blog
            </Link>
            <Link href="/login" className="text-sm text-muted hover:text-foreground transition">
              {t('common.signIn')}
            </Link>
            <Link
              href="/signup"
              className="px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-semibold rounded-xl transition"
            >
              {t('common.getStarted')}
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative py-28 px-6 overflow-hidden">
        <div className="absolute top-[-200px] left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-accent/10 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute bottom-[-100px] right-[-100px] w-[400px] h-[400px] bg-accent/5 rounded-full blur-[100px] pointer-events-none" />

        <div className="relative max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-accent/10 border border-accent/20 rounded-full text-xs text-accent font-medium mb-8">
            <span className="w-1.5 h-1.5 bg-accent rounded-full animate-pulse" />
            {t('landing.availablePlatforms')}
          </div>
          <h1 className="text-5xl sm:text-6xl font-bold leading-[1.1] mb-6 tracking-tight">
            {t('landing.heroTitle1')}
            <br />
            <span className="bg-gradient-to-r from-accent to-blue-400 bg-clip-text text-transparent">
              {t('landing.heroTitle2')}
            </span>
          </h1>
          <p className="text-lg sm:text-xl text-muted mb-10 max-w-2xl mx-auto leading-relaxed">
            {t('landing.heroDescription')}
          </p>
          <div className="flex items-center justify-center gap-4 flex-wrap">
            <Link
              href="/signup"
              className="px-8 py-3.5 bg-accent hover:bg-accent-hover text-white font-semibold rounded-xl transition text-lg shadow-lg shadow-accent/20"
            >
              {t('landing.startBuildingFree')}
            </Link>
            <Link
              href="/browse"
              className="px-8 py-3.5 border border-border hover:bg-surface text-foreground font-semibold rounded-xl transition text-lg"
            >
              {t('landing.browseApps')}
            </Link>
          </div>
        </div>
      </section>

      {/* Demo Mockup */}
      <section className="px-6 pb-20">
        <div className="max-w-5xl mx-auto">
          <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-2xl shadow-black/40">
            <div className="flex items-center gap-2 px-4 py-3 bg-surface border-b border-border">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-[#ff5f57]" />
                <div className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
                <div className="w-3 h-3 rounded-full bg-[#28ca41]" />
              </div>
              <div className="flex-1 text-center">
                <span className="text-xs text-subtle font-mono">vibebuild.com/project/new</span>
              </div>
            </div>

            <div className="flex min-h-[320px]">
              <div className="w-40 border-r border-border bg-card p-3 hidden sm:block">
                <div className="space-y-1">
                  <div className="px-2 py-1.5 text-xs text-accent bg-accent/10 rounded font-mono">index.html</div>
                  <div className="px-2 py-1.5 text-xs text-subtle rounded font-mono">style.css</div>
                  <div className="px-2 py-1.5 text-xs text-subtle rounded font-mono">app.js</div>
                </div>
              </div>

              <div className="flex-1 p-4 font-mono text-xs leading-relaxed overflow-hidden">
                <div><span className="text-[#c586c0]">&lt;div</span> <span className="text-[#9cdcfe]">class</span>=<span className="text-[#ce9178]">&quot;hero&quot;</span><span className="text-[#c586c0]">&gt;</span></div>
                <div className="pl-4"><span className="text-[#c586c0]">&lt;h1&gt;</span><span className="text-foreground">Welcome to my app</span><span className="text-[#c586c0]">&lt;/h1&gt;</span></div>
                <div className="pl-4"><span className="text-[#c586c0]">&lt;p&gt;</span><span className="text-foreground">Built with VibeBuild</span><span className="text-[#c586c0]">&lt;/p&gt;</span></div>
                <div className="pl-4"><span className="text-[#c586c0]">&lt;button</span> <span className="text-[#9cdcfe]">class</span>=<span className="text-[#ce9178]">&quot;cta&quot;</span><span className="text-[#c586c0]">&gt;</span></div>
                <div className="pl-8"><span className="text-foreground">Get Started</span></div>
                <div className="pl-4"><span className="text-[#c586c0]">&lt;/button&gt;</span></div>
                <div><span className="text-[#c586c0]">&lt;/div&gt;</span></div>
                <div className="mt-4 text-subtle">{t('landing.mockCodeComment')}</div>
              </div>

              <div className="w-1/3 border-l border-border bg-white p-6 hidden md:flex flex-col items-center justify-center text-center">
                <div className="text-black text-lg font-bold mb-1">Welcome to my app</div>
                <div className="text-gray-500 text-xs mb-3">Built with VibeBuild</div>
                <div className="px-4 py-1.5 bg-blue-500 text-white text-xs rounded-lg font-medium">Get Started</div>
              </div>
            </div>

            <div className="border-t border-border px-4 py-3 flex items-center gap-3 bg-surface">
              <div className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-xs text-subtle">
                {t('landing.mockChatPlaceholder')}
              </div>
              <div className="px-3 py-2 bg-accent rounded-lg text-xs text-white font-medium">{t('common.send')}</div>
            </div>
          </div>
        </div>
      </section>

      {/* Steps */}
      <section className="py-20 px-6 border-t border-border">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-4">{t('landing.howItWorks')}</h2>
          <p className="text-muted text-center mb-14 max-w-xl mx-auto">{t('landing.howItWorksSubtitle')}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {steps.map((step) => (
              <div key={step.num} className="relative">
                <div className="w-8 h-8 bg-accent/10 border border-accent/20 rounded-lg flex items-center justify-center text-accent text-sm font-bold mb-3">
                  {step.num}
                </div>
                <h3 className="text-base font-semibold mb-1">{step.title}</h3>
                <p className="text-sm text-muted leading-relaxed">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 px-6 border-t border-border">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-4">{t('landing.everythingYouNeed')}</h2>
          <p className="text-muted text-center mb-14 max-w-xl mx-auto">{t('landing.everythingYouNeedSubtitle')}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((f) => (
              <div
                key={f.title}
                className="p-5 bg-card border border-border rounded-xl hover:border-accent/20 transition group"
              >
                <div className="w-9 h-9 bg-accent/10 rounded-lg flex items-center justify-center text-accent mb-3 group-hover:bg-accent/15 transition">
                  {f.icon}
                </div>
                <h3 className="text-sm font-semibold mb-1.5">{f.title}</h3>
                <p className="text-xs text-muted leading-relaxed">{f.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="py-20 px-6 border-t border-border">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-4">{t('landing.pricing')}</h2>
          <p className="text-muted text-center mb-14 max-w-xl mx-auto">{t('landing.pricingSubtitle')}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto">
            {pricingPlans.map((plan) => (
              <div
                key={plan.name}
                className={`p-6 rounded-xl border ${
                  plan.highlighted ? 'border-accent bg-accent/5 relative' : 'border-border bg-card'
                }`}
              >
                {plan.highlighted && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 bg-accent text-white text-[10px] font-semibold rounded-full">
                    {t('landing.mostPopular')}
                  </div>
                )}
                <h3 className="text-lg font-semibold mb-1">{plan.name}</h3>
                <div className="flex items-baseline gap-1 mb-6">
                  <span className="text-3xl font-bold">{plan.price}</span>
                  <span className="text-sm text-muted">{plan.period}</span>
                </div>
                <ul className="space-y-3 mb-8">
                  {plan.features.map((feat) => (
                    <li key={feat} className="flex items-center gap-2 text-sm text-muted">
                      <svg className="w-4 h-4 text-success shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      {feat}
                    </li>
                  ))}
                </ul>
                <PricingCTA tier={plan.name.toLowerCase()} label={plan.cta} highlighted={plan.highlighted} />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-6 border-t border-border">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-4">{t('landing.readyToBuild')}</h2>
          <p className="text-muted mb-8">{t('landing.readyToBuildSubtitle')}</p>
          <Link
            href="/signup"
            className="inline-block px-8 py-3.5 bg-accent hover:bg-accent-hover text-white font-semibold rounded-xl transition text-lg shadow-lg shadow-accent/20"
          >
            {t('landing.getStartedFree')}
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8 px-6">
        <div className="max-w-6xl mx-auto flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-2 text-sm text-muted">
            <img src="/favicon-32x32.png" alt="VibeBuild" className="w-5 h-5 rounded" />
            <span>{t('common.vibebuild')}</span>
          </div>
          <div className="flex items-center gap-6 text-xs text-subtle">
            <Link href="/browse" className="hover:text-foreground transition">{t('common.browse')}</Link>
            <Link href="/blog" className="hover:text-foreground transition">Blog</Link>
            <Link href="/about" className="hover:text-foreground transition">About</Link>
            <Link href="/faq" className="hover:text-foreground transition">FAQ</Link>
            <Link href="/terms" className="hover:text-foreground transition">Terms</Link>
            <Link href="/privacy" className="hover:text-foreground transition">Privacy</Link>
            <Link href="/login" className="hover:text-foreground transition">{t('common.signIn')}</Link>
          </div>
          <p className="text-xs text-subtle">
            &copy; {new Date().getFullYear()} {t('common.vibebuild')}. {t('common.allRightsReserved')}
          </p>
        </div>
      </footer>
    </div>
  );
}
