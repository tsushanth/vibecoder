import { AuthForm } from '@/components/auth/AuthForm';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <div className="flex min-h-dvh flex-col bg-background px-5 py-8 text-foreground">
      <a href="/" className="flex items-center gap-2.5 self-start font-display text-xl font-semibold">
        <img src="/favicon-32x32.png" alt="" className="h-8 w-8 rounded-lg" />
        VibeBuild
      </a>
      <div className="flex flex-1 items-center py-10">
        <AuthForm mode="login" />
      </div>
    </div>
  );
}
