import Link from 'next/link';

const steps = [
  {
    num: '1',
    title: 'Describe',
    description: 'Tell us what you want to build in plain English.',
  },
  {
    num: '2',
    title: 'Generate',
    description: 'Our AI pipeline builds, validates, and polishes your app.',
  },
  {
    num: '3',
    title: 'Iterate',
    description: 'Chat with AI to tweak and refine. Jump between versions.',
  },
  {
    num: '4',
    title: 'Publish',
    description: 'Deploy to a live URL with one click. Share with the world.',
  },
];

const features = [
  {
    title: 'AI-Powered Pipeline',
    description:
      '5-phase generation: build, validate, fix, polish, and verify. Production-quality output every time.',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
  },
  {
    title: 'Live Preview & Code Editor',
    description:
      'See your app running instantly. Edit code directly or use natural language to describe changes.',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
      </svg>
    ),
  },
  {
    title: 'Version History',
    description:
      'Every tweak creates a version. Browse your history, compare changes, and revert anytime.',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    title: 'One-Click Deploy',
    description:
      'Publish to yourapp.vibecoder.app instantly. Custom domains for Pro users.',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
      </svg>
    ),
  },
  {
    title: 'Community & Remixing',
    description:
      'Browse apps built by others. Fork any public project and make it your own.',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    title: 'Cross-Platform',
    description:
      'Build on web, iOS, or Android. Your projects sync across all devices.',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
      </svg>
    ),
  },
];

const pricingPlans = [
  {
    name: 'Free',
    price: '$0',
    period: 'forever',
    features: ['3 generations / day', '3 tweaks / project', 'Public projects', 'Community browse'],
    cta: 'Start Free',
    highlighted: false,
  },
  {
    name: 'Pro',
    price: '$9.99',
    period: '/month',
    features: ['Unlimited generations', 'Unlimited tweaks', 'Private projects', 'Custom domains', 'Priority queue'],
    cta: 'Upgrade to Pro',
    highlighted: true,
  },
  {
    name: 'Team',
    price: '$29.99',
    period: '/month',
    features: ['Everything in Pro', 'Team collaboration', 'Shared projects', 'Admin dashboard'],
    cta: 'Contact Us',
    highlighted: false,
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 backdrop-blur-md sticky top-0 z-40 bg-background/80">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-lg font-bold">
            <span className="w-7 h-7 bg-accent rounded-lg flex items-center justify-center text-white text-xs font-bold">V</span>
            <span>VibeBuild</span>
          </div>
          <nav className="flex items-center gap-6">
            <Link href="/browse" className="text-sm text-muted hover:text-foreground transition">
              Browse
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

      {/* Hero */}
      <section className="relative py-28 px-6 overflow-hidden">
        {/* Gradient orbs */}
        <div className="absolute top-[-200px] left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-accent/10 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute bottom-[-100px] right-[-100px] w-[400px] h-[400px] bg-accent/5 rounded-full blur-[100px] pointer-events-none" />

        <div className="relative max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-accent/10 border border-accent/20 rounded-full text-xs text-accent font-medium mb-8">
            <span className="w-1.5 h-1.5 bg-accent rounded-full animate-pulse" />
            Now available on Web, iOS & Android
          </div>
          <h1 className="text-5xl sm:text-6xl font-bold leading-[1.1] mb-6 tracking-tight">
            Describe your app.
            <br />
            <span className="bg-gradient-to-r from-accent to-blue-400 bg-clip-text text-transparent">
              We build it.
            </span>
          </h1>
          <p className="text-lg sm:text-xl text-muted mb-10 max-w-2xl mx-auto leading-relaxed">
            Turn ideas into fully functional web apps with AI. Describe what you want,
            iterate with chat, and publish to a live URL — all in minutes.
          </p>
          <div className="flex items-center justify-center gap-4 flex-wrap">
            <Link
              href="/signup"
              className="px-8 py-3.5 bg-accent hover:bg-accent-hover text-white font-semibold rounded-xl transition text-lg shadow-lg shadow-accent/20"
            >
              Start Building — Free
            </Link>
            <Link
              href="/browse"
              className="px-8 py-3.5 border border-border hover:bg-surface text-foreground font-semibold rounded-xl transition text-lg"
            >
              Browse Apps
            </Link>
          </div>
        </div>
      </section>

      {/* Demo Mockup */}
      <section className="px-6 pb-20">
        <div className="max-w-5xl mx-auto">
          <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-2xl shadow-black/40">
            {/* Window chrome */}
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

            {/* Mock builder content */}
            <div className="flex min-h-[320px]">
              {/* Sidebar */}
              <div className="w-40 border-r border-border bg-card p-3 hidden sm:block">
                <div className="space-y-1">
                  <div className="px-2 py-1.5 text-xs text-accent bg-accent/10 rounded font-mono">index.html</div>
                  <div className="px-2 py-1.5 text-xs text-subtle rounded font-mono">style.css</div>
                  <div className="px-2 py-1.5 text-xs text-subtle rounded font-mono">app.js</div>
                </div>
              </div>

              {/* Code */}
              <div className="flex-1 p-4 font-mono text-xs leading-relaxed overflow-hidden">
                <div><span className="text-[#c586c0]">&lt;div</span> <span className="text-[#9cdcfe]">class</span>=<span className="text-[#ce9178]">&quot;hero&quot;</span><span className="text-[#c586c0]">&gt;</span></div>
                <div className="pl-4"><span className="text-[#c586c0]">&lt;h1&gt;</span><span className="text-foreground">Welcome to my app</span><span className="text-[#c586c0]">&lt;/h1&gt;</span></div>
                <div className="pl-4"><span className="text-[#c586c0]">&lt;p&gt;</span><span className="text-foreground">Built with VibeBuild</span><span className="text-[#c586c0]">&lt;/p&gt;</span></div>
                <div className="pl-4"><span className="text-[#c586c0]">&lt;button</span> <span className="text-[#9cdcfe]">class</span>=<span className="text-[#ce9178]">&quot;cta&quot;</span><span className="text-[#c586c0]">&gt;</span></div>
                <div className="pl-8"><span className="text-foreground">Get Started</span></div>
                <div className="pl-4"><span className="text-[#c586c0]">&lt;/button&gt;</span></div>
                <div><span className="text-[#c586c0]">&lt;/div&gt;</span></div>
                <div className="mt-4 text-subtle">// AI-generated, production-ready</div>
              </div>

              {/* Preview */}
              <div className="w-1/3 border-l border-border bg-white p-6 hidden md:flex flex-col items-center justify-center text-center">
                <div className="text-black text-lg font-bold mb-1">Welcome to my app</div>
                <div className="text-gray-500 text-xs mb-3">Built with VibeBuild</div>
                <div className="px-4 py-1.5 bg-blue-500 text-white text-xs rounded-lg font-medium">Get Started</div>
              </div>
            </div>

            {/* Chat bar at bottom */}
            <div className="border-t border-border px-4 py-3 flex items-center gap-3 bg-surface">
              <div className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-xs text-subtle">
                Describe changes to your app...
              </div>
              <div className="px-3 py-2 bg-accent rounded-lg text-xs text-white font-medium">Send</div>
            </div>
          </div>
        </div>
      </section>

      {/* Steps */}
      <section className="py-20 px-6 border-t border-border">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-4">
            How it works
          </h2>
          <p className="text-muted text-center mb-14 max-w-xl mx-auto">
            From idea to live app in four simple steps
          </p>
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
          <h2 className="text-3xl font-bold text-center mb-4">
            Everything you need
          </h2>
          <p className="text-muted text-center mb-14 max-w-xl mx-auto">
            A complete platform for building, iterating, and shipping web apps
          </p>
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
          <h2 className="text-3xl font-bold text-center mb-4">Pricing</h2>
          <p className="text-muted text-center mb-14 max-w-xl mx-auto">
            Start free, upgrade when you need more
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {pricingPlans.map((plan) => (
              <div
                key={plan.name}
                className={`p-6 rounded-xl border ${
                  plan.highlighted
                    ? 'border-accent bg-accent/5 relative'
                    : 'border-border bg-card'
                }`}
              >
                {plan.highlighted && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 bg-accent text-white text-[10px] font-semibold rounded-full">
                    Most Popular
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
                <Link
                  href="/signup"
                  className={`block text-center px-4 py-2.5 rounded-xl font-semibold text-sm transition ${
                    plan.highlighted
                      ? 'bg-accent hover:bg-accent-hover text-white shadow-lg shadow-accent/20'
                      : 'border border-border hover:bg-surface text-foreground'
                  }`}
                >
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-6 border-t border-border">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-4">Ready to build?</h2>
          <p className="text-muted mb-8">
            Join thousands of creators turning ideas into apps with AI.
          </p>
          <Link
            href="/signup"
            className="inline-block px-8 py-3.5 bg-accent hover:bg-accent-hover text-white font-semibold rounded-xl transition text-lg shadow-lg shadow-accent/20"
          >
            Get Started — Free
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8 px-6">
        <div className="max-w-6xl mx-auto flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-2 text-sm text-muted">
            <span className="w-5 h-5 bg-accent rounded flex items-center justify-center text-white text-[8px] font-bold">V</span>
            <span>VibeBuild</span>
          </div>
          <div className="flex items-center gap-6 text-xs text-subtle">
            <Link href="/browse" className="hover:text-foreground transition">Browse</Link>
            <Link href="/login" className="hover:text-foreground transition">Sign In</Link>
          </div>
          <p className="text-xs text-subtle">
            &copy; {new Date().getFullYear()} VibeBuild. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
