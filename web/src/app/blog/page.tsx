import type { Metadata } from 'next';
import Link from 'next/link';
import { ContentHeader, ContentFooter } from '@/components/landing/ContentLayout';

export const metadata: Metadata = {
  title: 'Blog - VibeBuild | AI App Building Tips & Tutorials',
  description: 'Learn about vibe coding, AI-powered app development, and how to build web apps without writing code. Tips, tutorials, and insights from the VibeBuild team.',
};

const posts = [
  {
    slug: 'what-is-vibe-coding',
    title: 'What Is Vibe Coding? The Future of Software Development',
    excerpt: 'Vibe coding is a new paradigm where you describe what you want in plain English and AI builds it for you. Learn how this approach is changing how we create software.',
    date: '2026-03-20',
    readTime: '6 min read',
    category: 'Guides',
  },
  {
    slug: 'build-web-app-without-coding',
    title: 'How to Build a Web App Without Writing a Single Line of Code',
    excerpt: 'Step-by-step guide to creating a fully functional web application using AI. From idea to deployment in under 10 minutes with VibeBuild.',
    date: '2026-03-18',
    readTime: '8 min read',
    category: 'Tutorials',
  },
  {
    slug: 'vibebuild-vs-bolt-vs-lovable',
    title: 'VibeBuild vs Bolt vs Lovable: Which AI App Builder Should You Use?',
    excerpt: 'An honest comparison of the top AI app builders in 2026. We break down features, pricing, output quality, and ideal use cases for each platform.',
    date: '2026-03-15',
    readTime: '10 min read',
    category: 'Comparisons',
  },
  {
    slug: '5-apps-you-can-build-with-ai',
    title: '5 Impressive Apps You Can Build with AI in Under 10 Minutes',
    excerpt: 'From productivity dashboards to interactive games — here are five real apps built by VibeBuild users that showcase what AI-powered development can do.',
    date: '2026-03-12',
    readTime: '5 min read',
    category: 'Inspiration',
  },
  {
    slug: 'ai-app-development-best-practices',
    title: 'Best Practices for AI-Assisted App Development',
    excerpt: 'How to write better prompts, iterate effectively, and get the most out of AI app builders. Practical tips from power users who have built hundreds of apps.',
    date: '2026-03-10',
    readTime: '7 min read',
    category: 'Guides',
  },
];

export default function BlogPage() {
  return (
    <div className="min-h-screen bg-background">
      <ContentHeader />

      <div className="max-w-4xl mx-auto px-6 py-12">
        <h1 className="text-4xl font-bold mb-3">Blog</h1>
        <p className="text-muted text-lg mb-10">
          Insights on AI app building, vibe coding, and the future of no-code development.
        </p>

        <div className="space-y-8">
          {posts.map((post) => (
            <Link
              key={post.slug}
              href={`/blog/${post.slug}`}
              className="block group p-6 bg-card border border-border rounded-xl hover:border-accent/30 transition"
            >
              <div className="flex items-center gap-3 mb-3">
                <span className="px-2 py-0.5 bg-accent/10 text-accent text-xs font-medium rounded-full">
                  {post.category}
                </span>
                <span className="text-xs text-subtle">{post.date}</span>
                <span className="text-xs text-subtle">{post.readTime}</span>
              </div>
              <h2 className="text-xl font-semibold mb-2 group-hover:text-accent transition">
                {post.title}
              </h2>
              <p className="text-muted text-sm leading-relaxed">{post.excerpt}</p>
            </Link>
          ))}
        </div>
      </div>

      <ContentFooter />
    </div>
  );
}
