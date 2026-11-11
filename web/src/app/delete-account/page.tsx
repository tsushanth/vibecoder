import type { Metadata } from 'next';
import { MarketingHeader, MarketingFooter } from '@/components/landing/MarketingChrome';

export const metadata: Metadata = {
  title: 'Delete Your Account - VibeBuild',
  description: 'How to delete your VibeBuild account and data, what is deleted, and what may remain.',
};

export default function DeleteAccountPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <MarketingHeader />

      <div className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="font-display text-4xl font-bold mb-2">Delete Your Account</h1>
        <p className="text-sm text-subtle mb-10">
          For the VibeBuild Android app (com.kreativekoala.vibecoder) and vibebuild.cc. Last updated: November 11, 2026
        </p>

        <div className="space-y-8 text-muted leading-relaxed text-sm">
          <section>
            <h2 className="font-display text-xl font-semibold text-foreground mb-3">Delete it yourself</h2>
            <ul className="list-disc pl-6 space-y-1">
              <li><strong className="text-foreground">In the Android app:</strong> open Account, tap Delete account, and confirm.</li>
              <li><strong className="text-foreground">On the website:</strong> sign in at vibebuild.cc, open Settings, choose Delete account, and confirm.</li>
              <li>If it says to sign in again, sign out, sign back in, and repeat. Deletion cannot be undone.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-foreground mb-3">Can&apos;t sign in? Ask us</h2>
            <p>
              Email{' '}
              <a href="mailto:support@vibebuild.cc?subject=Delete%20my%20VibeBuild%20account" className="text-accent-hover hover:underline">support@vibebuild.cc</a>{' '}
              with the subject &quot;Delete my VibeBuild account&quot;, from the address you signed up with. We may ask one question to confirm the
              account is yours, and we will delete it within 30 days.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-foreground mb-3">What is deleted</h2>
            <ul className="list-disc pl-6 space-y-1">
              <li>Your profile and sign-in record.</li>
              <li>Your projects and their build history, chats with the builder, and coin balance and history.</li>
              <li>The private copy of each app&apos;s code that we keep in a code repository, and each app&apos;s preview screenshot.</li>
              <li>The keys you added for your generated apps.</li>
              <li>Records of your project deployments, and our usage events tied to your account.</li>
              <li>Your published and preview sites, which are taken offline.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-foreground mb-3">What may remain</h2>
            <ul className="list-disc pl-6 space-y-1">
              <li>Records of your subscription and usage limits: email us from the address you signed up with and we will remove them.</li>
              <li>Purchase and tax records that the law requires us to keep, and Google Play and RevenueCat transaction records.</li>
              <li>Copies in routine backups, which are overwritten on the backups&apos; normal schedule.</li>
              <li>Anonymous, aggregated statistics.</li>
              <li>
                Data held by Google, Meta, TikTok and our other providers under their own policies; see our{' '}
                <a href="/privacy" className="text-accent-hover hover:underline">Privacy Policy</a>. You can reset your Android advertising ID in
                Settings, under Google, then Ads.
              </li>
            </ul>
          </section>
        </div>
      </div>

      <MarketingFooter />
    </div>
  );
}
