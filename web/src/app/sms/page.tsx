import type { Metadata } from 'next';
import Link from 'next/link';
import { MarketingHeader, MarketingFooter } from '@/components/landing/MarketingChrome';

export const metadata: Metadata = {
  title: 'Build Apps by Text - VibeBuild',
  description: 'Text VibeBuild to generate an app from your phone. How to opt in, what you\'ll receive, and how to opt out.',
};

export default function SmsPage() {
  return (
    <div className="theme-paper min-h-screen bg-[#FAF6F1] text-[#17140F]">
      <MarketingHeader />

      <div className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-4xl font-bold mb-2">Build apps by text</h1>
        <p className="text-[#17140F]/62 mb-10">
          Text VibeBuild what you want to build, and we&apos;ll text you back a link to your app.
        </p>

        <div className="space-y-8 text-[#17140F]/70 leading-relaxed text-sm">
          <section>
            <h2 className="text-xl font-semibold text-[#17140F] mb-3">How to opt in</h2>
            <p>
              Text any message describing an app you want (for example, <em>&quot;a todo app with dark mode&quot;</em>) to{' '}
              <a href="sms:+17752788677" className="text-[#5B4CFF] hover:underline font-semibold">+1 (775) 278-8677</a>.
              By sending that first message, you consent to receive SMS messages from VibeBuild
              (operated by KreativeKoalaSolutions LLC) related to your app build requests. You can also
              start the connection from the web by visiting{' '}
              <Link href="/connect" className="text-[#5B4CFF] hover:underline">vibebuild.cc/connect</Link>{' '}
              and linking your phone number in account settings.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#17140F] mb-3">What you&apos;ll receive</h2>
            <p>Once opted in, VibeBuild will text you:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li>A confirmation that your build has started</li>
              <li>A link to your finished app, usually within 30&ndash;60 seconds</li>
              <li>Status updates if you text <strong>HELP</strong> or <strong>STATUS</strong> while a build is running</li>
              <li>A one-time linking code if you sign in on the web to connect your account</li>
            </ul>
            <p className="mt-2">
              Message frequency varies based on how often you text us. Message and data rates may apply.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#17140F] mb-3">How to opt out</h2>
            <p>
              Reply <strong>STOP</strong> at any time to stop receiving messages from VibeBuild. Reply{' '}
              <strong>HELP</strong> for help. For support, email{' '}
              <a href="mailto:support@vibebuild.cc" className="text-[#5B4CFF] hover:underline">support@vibebuild.cc</a>.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#17140F] mb-3">Privacy</h2>
            <p>
              Your phone number is used only to deliver the messages described above and is never sold or
              shared for third-party marketing. See our{' '}
              <Link href="/privacy" className="text-[#5B4CFF] hover:underline">Privacy Policy</Link>{' '}
              and <Link href="/terms" className="text-[#5B4CFF] hover:underline">Terms of Service</Link> for details.
            </p>
          </section>
        </div>
      </div>

      <MarketingFooter />
    </div>
  );
}
