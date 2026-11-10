import type { Metadata } from 'next';
import Link from 'next/link';
import { MarketingHeader, MarketingFooter } from '@/components/landing/MarketingChrome';

export const metadata: Metadata = {
  title: 'Text messaging - VibeBuild',
  description: 'Building apps by text message is no longer available.',
  robots: { index: false, follow: false },
};

export default function SmsPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <MarketingHeader />

      <div className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="font-display text-4xl font-bold mb-2">Text messaging is no longer available</h1>
        <p className="text-muted mb-10">
          VibeBuild used to let you build apps by text message. That feature is switched off, so texting us will not start a build or get a reply.
        </p>

        <div className="space-y-8 text-muted leading-relaxed text-sm">
          <section>
            <h2 className="font-display text-xl font-semibold text-foreground mb-3">Build an app instead</h2>
            <p>
              You can build, preview and publish apps in the VibeBuild app and on the web at{' '}
              <Link href="/" className="text-accent-hover hover:underline">vibebuild.cc</Link>.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-foreground mb-3">If you texted us before</h2>
            <p>
              To have a phone number or the messages you sent removed, email{' '}
              <a href="mailto:support@vibebuild.cc" className="text-accent-hover hover:underline">support@vibebuild.cc</a>.
              See our <Link href="/privacy" className="text-accent-hover hover:underline">Privacy Policy</Link>{' '}
              and <Link href="/delete-account" className="text-accent-hover hover:underline">account deletion page</Link> for details.
            </p>
          </section>
        </div>
      </div>

      <MarketingFooter />
    </div>
  );
}
