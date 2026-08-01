import type { Metadata } from 'next';
import Link from 'next/link';
import { ContentHeader, ContentFooter } from '@/components/landing/ContentLayout';

export const metadata: Metadata = {
  title: 'FAQ - VibeBuild | Frequently Asked Questions',
  description: 'Frequently asked questions about VibeBuild, the AI-powered app builder. Learn about pricing, features, deployment, and more.',
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
    a: 'Yes! The free plan includes 3 app generations per day, 3 tweaks per project, public project hosting, and one-click deployment. Our Pro plan ($9.99/month) offers unlimited generations, unlimited tweaks, private projects, custom domains, and priority AI processing.',
  },
  {
    q: 'How does the AI pipeline work?',
    a: 'VibeBuild uses a 5-phase pipeline: (1) Generation — creates the app from your description, (2) Validation — checks code quality, (3) Fixing — automatically repairs any issues, (4) Polishing — refines the UI/UX, and (5) Verification — final quality check. This multi-pass approach produces higher quality apps than single-pass generators.',
  },
  {
    q: 'Can I edit the generated code?',
    a: 'Yes. While VibeBuild is designed for natural language interaction, you can also view and edit the generated HTML, CSS, and JavaScript directly in the built-in code editor.',
  },
  {
    q: 'How do I deploy my app?',
    a: 'Click the "Publish" button and your app gets a live URL instantly. No server setup or hosting configuration needed. Pro users can also connect custom domains.',
  },
  {
    q: 'Can other people see my apps?',
    a: 'By default, apps are public and visible in the community gallery. Pro users can create private projects that only they can access.',
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
    q: 'What happens if my free generations run out?',
    a: 'Free plan generations reset daily. You can also upgrade to Pro for unlimited generations at any time.',
  },
  {
    q: 'How do I get help or report a bug?',
    a: 'Email us at support@vibebuild.cc and we\'ll get back to you as soon as possible.',
  },
];

export default function FAQPage() {
  return (
    <div className="min-h-screen bg-background">
      <ContentHeader />

      <div className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-4xl font-bold mb-3">Frequently Asked Questions</h1>
        <p className="text-muted text-lg mb-10">
          Everything you need to know about VibeBuild.
        </p>

        <div className="space-y-6">
          {faqs.map((faq, i) => (
            <div key={i} className="p-5 bg-card border border-border rounded-xl">
              <h2 className="text-base font-semibold mb-2">{faq.q}</h2>
              <p className="text-sm text-muted leading-relaxed">{faq.a}</p>
            </div>
          ))}
        </div>

        <div className="mt-12 text-center py-10 border-t border-border">
          <h2 className="text-xl font-bold mb-3">Still have questions?</h2>
          <p className="text-muted mb-4">
            Email us at <a href="mailto:support@vibebuild.cc" className="text-accent hover:underline">support@vibebuild.cc</a> and
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

      <ContentFooter />
    </div>
  );
}
