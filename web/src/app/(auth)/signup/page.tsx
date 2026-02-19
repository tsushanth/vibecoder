import { AuthForm } from '@/components/auth/AuthForm';

export const dynamic = 'force-dynamic';

export default function SignupPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <a href="/" className="inline-flex items-center gap-2 text-xl font-bold">
            <span className="text-2xl">⚡</span>
            <span>VibeBuild</span>
          </a>
        </div>
        <AuthForm mode="signup" />
      </div>
    </div>
  );
}
