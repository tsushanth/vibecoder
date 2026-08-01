import type { Metadata } from 'next';
import { ContentHeader, ContentFooter } from '@/components/landing/ContentLayout';

export const metadata: Metadata = {
  title: 'Privacy Policy - VibeBuild',
  description: 'VibeBuild privacy policy. Learn how we collect, use, and protect your personal information.',
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <ContentHeader />

      <div className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-4xl font-bold mb-2">Privacy Policy</h1>
        <p className="text-sm text-subtle mb-10">Last updated: March 1, 2026</p>

        <div className="space-y-8 text-muted leading-relaxed text-sm">
          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">1. Introduction</h2>
            <p>
              KreativeKoalaSolutions LLC ("we", "us", "our") operates VibeBuild. This Privacy Policy explains
              how we collect, use, and protect your personal information when you use our platform at vibebuild.cc
              and our mobile applications.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">2. Information We Collect</h2>
            <h3 className="text-base font-semibold text-foreground mt-4 mb-2">Account Information</h3>
            <p>When you create an account, we collect your name, email address, and authentication credentials (or OAuth tokens if you sign in with Google).</p>

            <h3 className="text-base font-semibold text-foreground mt-4 mb-2">Usage Data</h3>
            <p>We collect information about how you use the Service, including app generation prompts, project metadata, and feature usage patterns. This helps us improve the AI pipeline and user experience.</p>

            <h3 className="text-base font-semibold text-foreground mt-4 mb-2">Device Information</h3>
            <p>We collect standard technical information such as browser type, operating system, device type, and IP address for analytics and security purposes.</p>

            <h3 className="text-base font-semibold text-foreground mt-4 mb-2">Payment Information</h3>
            <p>Payment processing is handled by third-party providers (Apple App Store, Google Play Store, or Stripe). We do not store your credit card information directly.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">3. How We Use Your Information</h2>
            <ul className="list-disc pl-6 space-y-1">
              <li>To provide and operate the Service</li>
              <li>To process your app generation requests</li>
              <li>To manage your account and subscriptions</li>
              <li>To improve our AI models and platform quality</li>
              <li>To communicate important updates and changes</li>
              <li>To detect and prevent fraud or abuse</li>
              <li>To comply with legal obligations</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">4. Data Sharing</h2>
            <p>We do not sell your personal information. We may share data with:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li><strong className="text-foreground">Service providers</strong> — hosting (Google Cloud), database (Supabase), analytics, and payment processing partners who help us operate the Service</li>
              <li><strong className="text-foreground">AI providers</strong> — your app prompts are sent to AI model providers for processing. These providers are contractually required to protect your data</li>
              <li><strong className="text-foreground">Legal requirements</strong> — when required by law, court order, or governmental authority</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">5. Public Projects</h2>
            <p>
              When you make a project public, its title, description, creator name, and generated app content
              are visible to all users in the community gallery. You can make projects private (Pro plan) or
              delete them at any time.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">6. Data Retention</h2>
            <p>
              We retain your account data and projects as long as your account is active. If you delete your
              account, we will remove your personal data within 30 days, except where retention is required
              by law. Anonymous, aggregated data may be retained indefinitely for analytics purposes.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">7. Data Security</h2>
            <p>
              We implement industry-standard security measures to protect your data, including encryption in
              transit (TLS) and at rest, secure authentication, and regular security audits. However, no method
              of electronic storage is 100% secure, and we cannot guarantee absolute security.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">8. Your Rights</h2>
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
            <h2 className="text-xl font-semibold text-foreground mb-3">9. Cookies</h2>
            <p>
              We use essential cookies for authentication and session management. We may use analytics cookies
              to understand how users interact with the Service. You can control cookie preferences through
              your browser settings.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">10. Children's Privacy</h2>
            <p>
              VibeBuild is not intended for children under 13. We do not knowingly collect personal information
              from children under 13. If you believe a child has provided us with personal information, please
              contact us.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">11. Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy from time to time. We will notify you of material changes via
              email or in-app notification. Your continued use of the Service constitutes acceptance of the
              updated policy.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">12. Contact Us</h2>
            <p>
              For privacy-related questions or concerns, contact us at{' '}
              <a href="mailto:support@vibebuild.cc" className="text-accent hover:underline">support@vibebuild.cc</a>.
            </p>
          </section>
        </div>
      </div>

      <ContentFooter />
    </div>
  );
}
