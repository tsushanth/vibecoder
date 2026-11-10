import type { Metadata } from 'next';
import { MarketingHeader, MarketingFooter } from '@/components/landing/MarketingChrome';
import { ALL_FREE } from '@/lib/pricing';

export const metadata: Metadata = {
  title: 'Privacy Policy - VibeBuild',
  description: 'VibeBuild privacy policy. Learn how we collect, use, and protect your personal information.',
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <MarketingHeader />

      <div className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="font-display text-4xl font-bold mb-2">Privacy Policy</h1>
        <p className="text-sm text-subtle mb-10">Last updated: November 10, 2026</p>

        <div className="space-y-8 text-muted leading-relaxed text-sm">
          <section>
            <h2 className="font-display text-xl font-semibold text-foreground mb-3">1. Introduction</h2>
            <p>
              KreativeKoalaSolutions LLC ("we", "us", "our") operates VibeBuild. This Privacy Policy explains
              how we collect, use, and protect your personal information when you use our platform at vibebuild.cc
              and our mobile applications.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-foreground mb-3">2. Information We Collect</h2>
            <h3 className="text-base font-semibold text-foreground mt-4 mb-2">Account Information</h3>
            <p>When you create an account, we collect your name, email address, and authentication credentials (or OAuth tokens if you sign in with Google).</p>

            <h3 className="text-base font-semibold text-foreground mt-4 mb-2">Usage Data</h3>
            <p>We collect information about how you use the Service, including app generation prompts, project metadata, and feature usage patterns. This helps us improve the AI pipeline and user experience.</p>

            <h3 className="text-base font-semibold text-foreground mt-4 mb-2">Device Information</h3>
            <p>We collect standard technical information such as browser type, operating system, device type, and IP address for analytics and security purposes.</p>

            <h3 className="text-base font-semibold text-foreground mt-4 mb-2">Voice Input (Android app)</h3>
            <p>If you tap the microphone button to dictate a prompt, the app asks for the microphone permission and uses Android&apos;s speech recognition to turn your speech into text. We receive only the text you then submit, not an audio recording.</p>

            <h3 className="text-base font-semibold text-foreground mt-4 mb-2">Advertising Identifier and Attribution (mobile apps)</h3>
            <p>The Android app includes analytics and attribution software from Google (Firebase Analytics), Meta (Facebook SDK) and TikTok (TikTok Business SDK). They receive app-install and in-app events, for example sign-up and purchase events, together with device identifiers such as the Android advertising ID, so that we can measure which ads and links lead to installs. The app declares the advertising ID permission. You can reset or delete your advertising ID, or opt out of ads personalization, in Android Settings under Google, then Ads. The VibeBuild website itself does not run advertising or analytics trackers.</p>

            <h3 className="text-base font-semibold text-foreground mt-4 mb-2">Payment Information</h3>
            <p>Payment processing is handled by third-party providers (Apple App Store, Google Play Store, or Stripe). We do not store your credit card information directly.</p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-foreground mb-3">3. How We Use Your Information</h2>
            <ul className="list-disc pl-6 space-y-1">
              <li>To provide and operate the Service</li>
              <li>To process your app generation requests</li>
              <li>{ALL_FREE ? 'To manage your account' : 'To manage your account and subscriptions'}</li>
              <li>To improve the app and the quality of the apps it generates</li>
              <li>To communicate important updates and changes</li>
              <li>To detect and prevent fraud or abuse</li>
              <li>To comply with legal obligations</li>
            </ul>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-foreground mb-3">4. Data Sharing</h2>
            <p>We do not sell your personal information. We may share data with:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li><strong className="text-foreground">Service providers</strong> — hosting (Fly.io), database and file storage (Supabase), sign-in and push notifications (Google, Firebase), purchase management (RevenueCat), and analytics and attribution partners (Google Firebase Analytics, Meta, TikTok) that help us operate the Service</li>
              <li><strong className="text-foreground">AI providers</strong> — your app prompts and the generated code are sent to AI model providers (currently Anthropic) for processing. Do not put personal information in prompts</li>
              <li><strong className="text-foreground">Legal requirements</strong> — when required by law, court order, or governmental authority</li>
            </ul>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-foreground mb-3">5. Public Projects</h2>
            <p>
              When you make a project public, its title, description, creator name, and generated app content
              are visible to all users in the community gallery. You can make projects private{ALL_FREE ? '' : ' (Pro plan)'} or
              delete them at any time.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-foreground mb-3">6. Data Retention</h2>
            <p>
              We retain your account data and projects as long as your account is active. You can delete your
              account in the app (Account, then Delete account) or on the website (Settings, then Delete account), or
              ask us by email; see <a href="/delete-account" className="text-accent-hover hover:underline">how to delete your account</a>.
              Deleting an account removes your profile, projects, chats and coin history; we remove any remaining
              personal data within 30 days, except where retention is required by law. Data held by Google, Meta,
              TikTok and our other providers follows their own policies. Anonymous, aggregated data may be retained
              indefinitely for analytics purposes.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-foreground mb-3">7. Data Security</h2>
            <p>
              We implement industry-standard security measures to protect your data, including encryption in
              transit (TLS), encrypted storage at our database provider, and secure authentication. However, no method
              of electronic storage is 100% secure, and we cannot guarantee absolute security.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-foreground mb-3">8. Your Rights</h2>
            <p>Depending on your jurisdiction, you may have the right to:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li>Access your personal data</li>
              <li>Correct inaccurate data</li>
              <li>Delete your data</li>
              <li>Export your data</li>
              <li>Opt out of marketing communications</li>
              <li>Restrict certain processing activities</li>
            </ul>
            <p className="mt-2">To exercise these rights, contact us at support@vibebuild.cc.</p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-foreground mb-3">9. SMS / Text Messaging</h2>
            <p>
              Building apps by text message is currently not available and we are not sending text messages. If you
              texted VibeBuild or linked a phone number in the past and want that phone number or those messages
              deleted, contact us at support@vibebuild.cc. Phone numbers were used only to run that feature and were
              never shared with third parties or affiliates for marketing or promotional purposes. See{' '}
              <a href="/sms" className="text-accent-hover hover:underline">vibebuild.cc/sms</a> for the current status.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-foreground mb-3">10. Cookies</h2>
            <p>
              We use essential cookies for authentication and session management. We may use analytics cookies
              to understand how users interact with the Service. You can control cookie preferences through
              your browser settings.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-foreground mb-3">11. Children's Privacy</h2>
            <p>
              VibeBuild is not intended for children under 13. We do not knowingly collect personal information
              from children under 13. If you believe a child has provided us with personal information, please
              contact us.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-foreground mb-3">12. Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy from time to time. We will notify you of material changes via
              email or in-app notification. Your continued use of the Service constitutes acceptance of the
              updated policy.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-foreground mb-3">13. Contact Us</h2>
            <p>
              For privacy-related questions or concerns, contact us at{' '}
              <a href="mailto:support@vibebuild.cc" className="text-accent-hover hover:underline">support@vibebuild.cc</a>.
            </p>
          </section>
        </div>
      </div>

      <MarketingFooter />
    </div>
  );
}
