import type { Metadata } from 'next';
import { ContentHeader, ContentFooter } from '@/components/landing/ContentLayout';

export const metadata: Metadata = {
  title: 'Terms of Service - VibeBuild',
  description: 'VibeBuild terms of service. Read our terms and conditions for using the VibeBuild platform.',
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background">
      <ContentHeader />

      <div className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-4xl font-bold mb-2">Terms of Service</h1>
        <p className="text-sm text-subtle mb-10">Last updated: March 1, 2026</p>

        <div className="space-y-8 text-muted leading-relaxed text-sm">
          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">1. Acceptance of Terms</h2>
            <p>
              By accessing or using VibeBuild ("the Service"), operated by KreativeKoalaSolutions LLC ("we", "us", "our"),
              you agree to be bound by these Terms of Service. If you do not agree to these terms, do not use the Service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">2. Description of Service</h2>
            <p>
              VibeBuild is an AI-powered platform that enables users to create web applications by providing
              natural language descriptions. The Service includes app generation, hosting, deployment, and community features.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">3. User Accounts</h2>
            <p>
              You must create an account to use certain features of the Service. You are responsible for maintaining
              the confidentiality of your account credentials and for all activities that occur under your account.
              You must provide accurate and complete information when creating your account.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">4. User Content</h2>
            <p>
              You retain ownership of the apps and content you create using VibeBuild. By making a project public,
              you grant other users the right to view, fork, and build upon your project. You are solely responsible
              for the content of your apps and must ensure they do not violate any laws or third-party rights.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">5. Acceptable Use</h2>
            <p>You agree not to use the Service to:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li>Create apps containing illegal, harmful, or offensive content</li>
              <li>Violate any applicable laws or regulations</li>
              <li>Infringe on the intellectual property rights of others</li>
              <li>Distribute malware, spam, or phishing content</li>
              <li>Attempt to circumvent usage limits or security measures</li>
              <li>Use the Service for any purpose that could harm minors</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">6. Subscriptions and Payments</h2>
            <p>
              Paid plans are billed monthly or annually as selected. Subscriptions automatically renew unless
              cancelled before the renewal date. Refunds are handled on a case-by-case basis. We reserve the
              right to change pricing with 30 days' notice.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">7. Intellectual Property</h2>
            <p>
              The VibeBuild platform, including its design, code, AI models, and branding, is the intellectual
              property of KreativeKoalaSolutions LLC. You may not copy, modify, or distribute any part of the
              platform itself. The apps you create using VibeBuild belong to you.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">8. Limitation of Liability</h2>
            <p>
              VibeBuild is provided "as is" without warranties of any kind. We are not liable for any damages
              arising from your use of the Service, including but not limited to loss of data, revenue, or
              business opportunities. Our total liability shall not exceed the amount you paid for the Service
              in the 12 months preceding the claim.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">9. Termination</h2>
            <p>
              We may suspend or terminate your account if you violate these terms. You may delete your account
              at any time through your account settings. Upon termination, your hosted apps may be removed.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">10. Changes to Terms</h2>
            <p>
              We may update these terms from time to time. We will notify users of material changes via email
              or in-app notification. Continued use of the Service after changes constitutes acceptance of the
              updated terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">11. Contact</h2>
            <p>
              For questions about these terms, contact us at{' '}
              <a href="mailto:support@vibebuild.cc" className="text-accent hover:underline">support@vibebuild.cc</a>.
            </p>
          </section>
        </div>
      </div>

      <ContentFooter />
    </div>
  );
}
