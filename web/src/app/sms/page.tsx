import type { Metadata } from 'next';
import Link from 'next/link';
import { MarketingHeader, MarketingFooter } from '@/components/landing/MarketingChrome';

// Public description of the text-message program (the page carrier registration reviewers read). It must stay in step with sms-bot/
// (opt-in by texting first, STOP/START/HELP, replies only to people who texted us first, US and Canada numbers).
export const metadata: Metadata = {
  title: 'VibeBuild by text message',
  description: 'How the VibeBuild text-message program works: who we text, what we send, how often, and how to stop.',
};

const NUMBER_DISPLAY = '+1 (855) 918-6924';

export default function SmsPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <MarketingHeader />

      <div className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="font-display text-4xl font-bold mb-2">VibeBuild by text message</h1>
        <p className="text-muted mb-10">
          Describe an app in a text message and VibeBuild builds it and texts you the link. This page explains the program: what we send,
          who we send it to, how often, and how to stop.
        </p>

        <div className="space-y-8 text-muted leading-relaxed text-sm">
          <section>
            <h2 className="font-display text-xl font-semibold text-foreground mb-3">How you join</h2>
            <p>
              You join by texting us first. Send a text message from your own mobile phone to <strong className="text-foreground">{NUMBER_DISPLAY}</strong>,
              for example a short description of the app you want. We never text a person who has not texted us first, and we do not send
              promotional or marketing messages. By texting us you agree to receive the replies described below at that number.
            </p>
            <p className="mt-3">
              Available to mobile numbers in the United States and Canada. Text messaging is rolling out: if you do not get a reply, you can
              build the same app in the VibeBuild app or on <Link href="/" className="text-accent-hover hover:underline">vibebuild.cc</Link>.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-foreground mb-3">What we send</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>Replies to the messages you send us, including a short welcome and instructions.</li>
              <li>Progress and the finished result of an app you asked us to build, with a link to preview it.</li>
              <li>A confirmation when you link your text number to your VibeBuild account, and answers to support questions you text us.</li>
            </ul>
            <p className="mt-3">
              Message frequency depends on how much you use it: typically 1 to 4 messages for each app you build. Message and data rates may apply.
              Carriers are not liable for delayed or undelivered messages.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-foreground mb-3">Stop, help and start</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>Reply <strong className="text-foreground">STOP</strong> (or UNSUBSCRIBE, CANCEL, END or QUIT) at any time to stop all messages. We confirm once and then send nothing more.</li>
              <li>Reply <strong className="text-foreground">START</strong> to turn messages back on.</li>
              <li>Reply <strong className="text-foreground">HELP</strong> for help, or email{' '}
                <a href="mailto:support@vibebuild.cc" className="text-accent-hover hover:underline">support@vibebuild.cc</a>.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-foreground mb-3">Your phone number and privacy</h2>
            <p>
              We use your number only to run this program. We do not sell it or share it with third parties or affiliates for marketing or
              promotional purposes; it is passed only to the messaging provider that delivers the texts. To have your number and the messages
              you sent removed, email{' '}
              <a href="mailto:support@vibebuild.cc" className="text-accent-hover hover:underline">support@vibebuild.cc</a>. Read our{' '}
              <Link href="/privacy" className="text-accent-hover hover:underline">Privacy Policy</Link> and{' '}
              <Link href="/terms" className="text-accent-hover hover:underline">Terms</Link>, and see how to{' '}
              <Link href="/delete-account" className="text-accent-hover hover:underline">delete your account</Link>.
            </p>
            <p className="mt-3">VibeBuild is operated by KreativeKoalaSolutions LLC.</p>
          </section>
        </div>
      </div>

      <MarketingFooter />
    </div>
  );
}
