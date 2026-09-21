import type { Metadata } from 'next';
import Link from 'next/link';
import { MarketingHeader, MarketingFooter } from '@/components/landing/MarketingChrome';

export const metadata: Metadata = {
  title: 'About VibeBuild - AI-Powered App Builder',
  description: 'VibeBuild is an AI-powered platform that lets anyone create web apps by describing what they want. Learn about our mission, technology, and team.',
};

export default function AboutPage() {
  return (
    <div className="theme-paper min-h-screen bg-[#FAF6F1] text-[#17140F]">
      <MarketingHeader />

      <div className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-4xl font-bold mb-6">About VibeBuild</h1>

        <div className="space-y-8 text-[#17140F]/62 leading-relaxed">
          <section>
            <h2 className="text-2xl font-semibold text-[#17140F] mb-3">Our Mission</h2>
            <p>
              VibeBuild exists to make app creation accessible to everyone. We believe that building software
              should be as natural as describing an idea to a colleague. Our AI-powered platform bridges the gap
              between imagination and implementation, enabling anyone — regardless of technical background — to
              bring their app ideas to life.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-[#17140F] mb-3">How It Works</h2>
            <p>
              VibeBuild uses a proprietary multi-phase AI pipeline to transform natural language descriptions
              into fully functional web applications. Unlike simple code generators, our system goes through
              five distinct phases:
            </p>
            <ol className="list-decimal pl-6 mt-3 space-y-2">
              <li><strong className="text-[#17140F]">Generation</strong> — AI creates the complete app from your description</li>
              <li><strong className="text-[#17140F]">Validation</strong> — Automated checks ensure code quality and accessibility</li>
              <li><strong className="text-[#17140F]">Fixing</strong> — Any issues are detected and repaired automatically</li>
              <li><strong className="text-[#17140F]">Polishing</strong> — UI and UX are refined for a professional finish</li>
              <li><strong className="text-[#17140F]">Verification</strong> — Final quality assurance before deployment</li>
            </ol>
            <p className="mt-3">
              This pipeline ensures that every app generated meets high standards of quality, regardless of how
              technical your description is.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-[#17140F] mb-3">Our Community</h2>
            <p>
              VibeBuild is more than a tool — it's a community of creators. Our <Link href="/browse" className="text-[#5B4CFF] hover:underline">community gallery</Link> showcases
              thousands of apps built by users around the world. You can browse, try live demos, and fork any public
              project to make it your own. This open ecosystem means you're never starting from scratch — there's
              always inspiration and building blocks available.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-[#17140F] mb-3">Available Everywhere</h2>
            <p>
              VibeBuild is available on the web at <Link href="/" className="text-[#5B4CFF] hover:underline">vibebuild.cc</Link>,
              and as native apps on iOS and Android. Build apps from your desk, your couch, or on the go — your
              projects sync across all devices.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-[#17140F] mb-3">Contact Us</h2>
            <p>
              Have questions, feedback, or partnership inquiries? We'd love to hear from you.
              Reach us at <a href="mailto:support@vibebuild.cc" className="text-[#5B4CFF] hover:underline">support@vibebuild.cc</a>.
            </p>
          </section>
        </div>

        {/* CTA */}
        <div className="mt-12 text-center py-10 border-t border-[#17140F]/12">
          <h2 className="text-2xl font-bold mb-3">Ready to build something?</h2>
          <p className="text-[#17140F]/62 mb-6">Join thousands of creators building apps with AI.</p>
          <Link
            href="/signup"
            className="inline-block px-8 py-3.5 bg-[#5B4CFF] hover:bg-[#4638D6] text-white font-semibold rounded-xl transition text-lg"
          >
            Get Started Free
          </Link>
        </div>
      </div>

      <MarketingFooter />
    </div>
  );
}
