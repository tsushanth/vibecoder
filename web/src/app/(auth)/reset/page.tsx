import Link from 'next/link';
import { ResetPasswordForm } from '@/components/auth/ResetPasswordForm';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <div className="flex min-h-dvh flex-col bg-background px-5 py-8 text-foreground">
      <Link href="/" className="flex items-center gap-2.5 self-start font-display text-xl font-semibold">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/favicon-32x32.png" alt="" className="h-8 w-8 rounded-lg" />
        VibeBuild
      </Link>
      <div className="flex flex-1 items-center py-10">
        <ResetPasswordForm />
      </div>
    </div>
  );
}
