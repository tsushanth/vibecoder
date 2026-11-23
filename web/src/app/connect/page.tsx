'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Script from 'next/script';
import { useSearchParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import { api } from '@/lib/api';
import { telegramBotUrl, telegramLinkUrl, trackTelegram, TELEGRAM_CLICK_EVENT } from '@/lib/telegramBot';

type Step = 'loading' | 'sign-in' | 'generating' | 'done' | 'error' | 'start';

// Links a chat identity (Telegram, or a phone number for the SMS/WhatsApp bot) to the signed-in VibeBuild account.
//   /connect?tg_id=<id>&src=tg  comes from the Telegram bot's /link button: the code is shown AND a button opens Telegram with it
//   /connect?tg_id=<phone>      comes from the SMS/WhatsApp bot: the code is shown to be texted back
//   /connect                    no id: send the person to the bot, whose /link command brings them back here
export default function ConnectPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tgId = searchParams.get('tg_id');
  const fromTelegram = searchParams.get('src') === 'tg';

  const [step, setStep] = useState<Step>('loading');
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!tgId) {
      setStep('start');
      return;
    }
    void checkSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tgId]);

  async function checkSession() {
    const { data: { session } } = await createClient().auth.getSession();
    if (session?.user) await generateCode(session.user.id);
    else setStep('sign-in');
  }

  async function generateCode(userId: string) {
    setStep('generating');
    try {
      const data = await api.get<{ success: boolean; code?: string; error?: string }>(
        `/api/telegram/connect?tg_id=${encodeURIComponent(tgId!)}&user_id=${encodeURIComponent(userId)}`,
      );
      if (!data.success || !data.code) throw new Error(data.error || 'Could not create a code. Please try again.');
      setCode(data.code);
      setStep('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create a code. Please try again.');
      setStep('error');
    }
  }

  function handleCopy() {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }

  function handleSignIn() {
    const back = `/connect?tg_id=${encodeURIComponent(tgId!)}${fromTelegram ? '&src=tg' : ''}`;
    router.push(`/login?redirect=${encodeURIComponent(back)}`);
  }

  const shell = (children: React.ReactNode) => (
    <div className="flex min-h-dvh items-center justify-center bg-background p-5 text-foreground">
      <div className="w-full max-w-sm text-center">{children}</div>
    </div>
  );
  const primary = 'block w-full rounded-lg bg-accent px-6 py-3 text-center font-semibold text-white transition hover:bg-accent-hover';

  if (step === 'loading' || step === 'generating') {
    return shell(
      <>
        <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        <p className="text-muted">{step === 'loading' ? 'Loading…' : 'Creating your code…'}</p>
      </>,
    );
  }

  if (step === 'start') {
    return shell(
      <>
        <h1 className="font-display text-2xl font-bold">Build apps from Telegram</h1>
        <p className="mb-6 mt-2 text-muted">
          Message the VibeBuild bot an idea in your own language. It builds the app and sends you the link. To keep those apps in your VibeBuild account, send /link to the bot.
        </p>
        <a href={telegramBotUrl('web_connect')} target="_blank" rel="noopener" onClick={() => trackTelegram(TELEGRAM_CLICK_EVENT, 'web_connect')} className={primary}>Open the Telegram bot</a>
        <Link href="/" className="mt-4 block text-sm text-muted underline">Back to VibeBuild</Link>
        {/* Visit counter for this one state only: no account, chat id or code is on screen or in the address (the page has no query here), so the
            counter sees a bare /connect. The other states put a Telegram id in the address and never load it. Same tag as MarketingChrome. */}
        <Script id="gaugemint" defer data-domain="vibebuild.cc" src="https://guagemint.com/js/script.js" strategy="afterInteractive" />
      </>,
    );
  }

  if (step === 'error') {
    return shell(
      <>
        <p className="mb-4 text-red-400">{error}</p>
        <Link href="/" className="text-sm text-muted underline">Go to VibeBuild</Link>
      </>,
    );
  }

  if (step === 'sign-in') {
    return shell(
      <>
        <h1 className="font-display text-2xl font-bold">Connect your chat</h1>
        <p className="mb-6 mt-2 text-muted">Sign in to VibeBuild to link this chat to your account, so apps you build there also show up in the app.</p>
        <button onClick={handleSignIn} className={primary}>Sign in to VibeBuild</button>
      </>,
    );
  }

  return shell(
    <>
      <h1 className="font-display text-2xl font-bold">Almost there</h1>
      {fromTelegram ? (
        <>
          <p className="mb-6 mt-2 text-muted">Tap the button to finish in Telegram. The link works once and expires in 10 minutes.</p>
          <a href={telegramLinkUrl(code)} className={primary}>Open Telegram to finish</a>
          <p className="mb-2 mt-6 text-sm text-muted">Or send this code to the bot:</p>
        </>
      ) : (
        <p className="mb-6 mt-2 text-muted">Send this code back in the chat to finish linking your account.</p>
      )}
      <div className="rounded-2xl border border-border bg-surface p-6">
        <div className="mb-4 font-mono text-4xl font-bold tracking-widest text-accent-hover">{code}</div>
        <button onClick={handleCopy} className="w-full rounded-lg border border-border px-6 py-2.5 text-sm font-semibold transition hover:border-accent">
          {copied ? 'Copied' : 'Copy code'}
        </button>
      </div>
      <p className="mt-4 text-xs text-subtle">This code expires in 10 minutes.</p>
    </>,
  );
}
