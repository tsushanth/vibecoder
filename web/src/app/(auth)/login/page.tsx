import { AuthForm } from '@/components/auth/AuthForm';

export const dynamic = 'force-dynamic';

export default function LoginPage() {
  return (
    <div className="theme-paper flex min-h-screen items-center justify-center bg-[#FAF6F1] p-4 text-[#17140F]">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <a href="/" className="inline-flex items-center gap-2 text-xl font-semibold">
            <img src="/favicon-32x32.png" alt="" className="h-8 w-8 rounded-lg" />
            VibeBuild
          </a>
        </div>
        <AuthForm mode="login" />
      </div>
    </div>
  );
}
