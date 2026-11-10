import type { Metadata } from 'next';
import Link from 'next/link';
import { MarketingHeader, MarketingFooter } from '@/components/landing/MarketingChrome';
import { ALL_FREE } from '@/lib/pricing';

export const metadata: Metadata = {
  title: 'FAQ - VibeBuild | Frequently Asked Questions',
  description: 'Frequently asked questions about VibeBuild, the AI-powered app builder. Learn about features, deployment, and more. VibeBuild is free for now.',
};

const faqs = [
  {
    q: 'What is VibeBuild?',
    a: 'VibeBuild is an AI-powered platform that lets you create fully functional web apps by describing what you want in plain English. Our multi-phase AI pipeline generates, validates, and deploys your app automatically.',
  },
  {
    q: 'Do I need to know how to code?',
    a: 'Not at all. VibeBuild is designed for everyone — whether you\'re a seasoned developer or someone who has never written a line of code. Just describe your app idea and the AI handles the rest.',
  },
  {
    q: 'What kind of apps can I build?',
    a: 'You can build any web-based application: dashboards, tools, games, landing pages, calculators, trackers, forms, and more. Browse our community gallery to see examples of what users have created.',
  },
  {
    q: 'Is VibeBuild free?',
    a: ALL_FREE
      ? 'Yes. VibeBuild is free while we grow: every feature is included, no credit card. That includes private projects, custom domains, and one-click deployment. A fair-use daily limit on builds gives everyone a turn.'
      : 'Yes. The free plan includes 3 tweaks per project, public project hosting, and one-click deployment. Pro ($9.99 a month) adds unlimited tweaks, private projects, and custom domains.',
  },
  {
    q: 'How does the AI pipeline work?',
    a: 'VibeBuild uses a 5-phase pipeline: (1) Generation — creates the app from your description, (2) Validation — checks code quality, (3) Fixing — automatically repairs any issues, (4) Polishing — refines the UI/UX, and (5) Verification — final quality check. This multi-pass approach produces higher quality apps than single-pass generators.',
  },
  {
    q: 'Can I edit the generated code?',
    a: 'Not directly yet. VibeBuild does not have a code editor. You change your app by describing the change in the chat, for example "make the header blue", and VibeBuild updates the code for you. Every change is saved as a version, so you can go back to an earlier one at any time.',
  },
  {
    q: 'How do I deploy my app?',
    a: 'Click the "Publish" button and your app gets a live URL instantly. No server setup or hosting configuration needed. ' + (ALL_FREE ? 'You can also connect your own custom domain.' : 'Pro users can also connect custom domains.'),
  },
  {
    q: 'Can other people see my apps?',
    a: 'New apps are not listed anywhere: only you see them in your Apps tab. If you publish one, anyone with its link can open it. You can also choose "Show on Explore" in the Publish dialog to list it on the public Explore page, where your name appears as a first name and an initial. You can turn it off again at any time.',
  },
  {
    q: 'What is forking?',
    a: 'Forking lets you create your own copy of any public project. It\'s a great way to learn from others\' work or use an existing app as a starting point for your own ideas.',
  },
  {
    q: 'Is VibeBuild available on mobile?',
    a: 'Yes! VibeBuild has native apps for both iOS and Android, so you can build and manage apps from anywhere. Your projects sync across all devices.',
  },
  {
    q: ALL_FREE ? 'Is there a limit on how much I can build?' : 'What happens if my free generations run out?',
    a: ALL_FREE
      ? 'There is a generous fair-use limit on builds per day so everyone gets a turn. If you reach it, come back the next day and keep building.'
      : 'Free plan generations reset daily. You can also upgrade to Pro for unlimited generations at any time.',
  },
  {
    q: 'How do I get help or report a bug?',
    a: 'Email us at support@vibebuild.cc and we\'ll get back to you as soon as possible.',
  },
];

export default function FAQPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <MarketingHeader />

      <div className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="font-display text-4xl font-bold mb-3">Frequently Asked Questions</h1>
        <p className="text-muted text-lg mb-10">
          Everything you need to know about VibeBuild.
        </p>

        <div className="space-y-6">
          {faqs.map((faq, i) => (
            <div key={i} className="p-5 bg-card border border-border rounded-xl">
              <h2 className="font-display text-base font-semibold mb-2">{faq.q}</h2>
              <p className="text-sm text-muted leading-relaxed">{faq.a}</p>
            </div>
          ))}
        </div>

        <div className="mt-12 text-center py-10 border-t border-border">
          <h2 className="font-display text-xl font-bold mb-3">Still have questions?</h2>
          <p className="text-muted mb-4">
            Email us at <a href="mailto:support@vibebuild.cc" className="text-accent-hover hover:underline">support@vibebuild.cc</a> and
            we'll get back to you.
          </p>
          <Link
            href="/signup"
            className="inline-block px-6 py-3 bg-accent hover:bg-accent-hover text-white font-semibold rounded-xl transition"
          >
            Get Started Free
          </Link>
        </div>
      </div>

      <MarketingFooter />
    </div>
  );
}
