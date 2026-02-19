import Link from 'next/link';

const features = [
  {
    icon: '⚡',
    title: 'AI-Powered Generation',
    description:
      'Our 5-phase pipeline generates, validates, fixes, polishes, and verifies your app automatically.',
  },
  {
    icon: '👁',
    title: 'Live Preview & Edit',
    description:
      'See your app running instantly. Iterate with natural language — just describe what to change.',
  },
  {
    icon: '🚀',
    title: 'One-Click Deploy',
    description:
      'Deploy to a live URL with one click. Custom domains supported for Pro users.',
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
      <header className="border-b border-border">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-lg font-bold">
            <span className="text-xl">⚡</span>
            <span>VibeBuild</span>
          </div>
          <nav className="flex items-center gap-6">
            <Link href="/browse" className="text-sm text-muted hover:text-foreground transition">
              Browse
            </Link>
            <Link
              href="/login"
              className="text-sm text-muted hover:text-foreground transition"
            >
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
      <section className="py-24 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <h1 className="text-5xl font-bold leading-tight mb-6">
            Describe your app.
            <br />
            <span className="text-accent">We build it.</span>
          </h1>
          <p className="text-xl text-muted mb-10 max-w-2xl mx-auto">
            Build fully functional web apps by describing what you want. Our
            AI-powered pipeline generates, validates, and deploys your app in
            minutes.
          </p>
          <div className="flex items-center justify-center gap-4">
            <Link
              href="/signup"
              className="px-8 py-3.5 bg-accent hover:bg-accent-hover text-white font-semibold rounded-xl transition text-lg"
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

      {/* Features */}
      <section className="py-20 px-6 border-t border-border">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-12">
            How it works
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {features.map((f) => (
              <div
                key={f.title}
                className="p-6 bg-card border border-border rounded-xl"
              >
                <div className="text-3xl mb-4">{f.icon}</div>
                <h3 className="text-lg font-semibold mb-2">{f.title}</h3>
                <p className="text-sm text-muted">{f.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="py-20 px-6 border-t border-border">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-12">Pricing</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {pricingPlans.map((plan) => (
              <div
                key={plan.name}
                className={`p-6 rounded-xl border ${
                  plan.highlighted
                    ? 'border-accent bg-accent/5'
                    : 'border-border bg-card'
                }`}
              >
                <h3 className="text-lg font-semibold mb-1">{plan.name}</h3>
                <div className="flex items-baseline gap-1 mb-6">
                  <span className="text-3xl font-bold">{plan.price}</span>
                  <span className="text-sm text-muted">{plan.period}</span>
                </div>
                <ul className="space-y-3 mb-8">
                  {plan.features.map((feat) => (
                    <li key={feat} className="flex items-center gap-2 text-sm text-muted">
                      <span className="text-success">&#10003;</span>
                      {feat}
                    </li>
                  ))}
                </ul>
                <Link
                  href="/signup"
                  className={`block text-center px-4 py-2.5 rounded-xl font-semibold text-sm transition ${
                    plan.highlighted
                      ? 'bg-accent hover:bg-accent-hover text-white'
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

      {/* Footer */}
      <footer className="border-t border-border py-8 px-6">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted">
            <span>⚡</span>
            <span>VibeBuild</span>
          </div>
          <p className="text-xs text-subtle">
            &copy; {new Date().getFullYear()} VibeBuild. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
