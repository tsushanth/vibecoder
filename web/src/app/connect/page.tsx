'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import { API_URL } from '@/lib/constants';

type Step = 'loading' | 'sign-in' | 'generating' | 'done' | 'error';

export default function TelegramConnectPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tgId = searchParams.get('tg_id');

  const [step, setStep] = useState<Step>('loading');
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!tgId) {
      setError('Missing Telegram ID. Please use the link sent by the bot.');
      setStep('error');
      return;
    }
    checkSession();
  }, [tgId]);

  async function checkSession() {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      await generateCode(session.user.id);
    } else {
      setStep('sign-in');
    }
  }

  async function generateCode(userId: string) {
    setStep('generating');
    try {
      const res = await fetch(`${API_URL}/api/telegram/connect?tg_id=${tgId}&user_id=${userId}`);
      const data = await res.json();
      if (data.success) {
        setCode(data.code);
        setStep('done');
      } else {
        throw new Error(data.error || 'Failed to generate code');
      }
    } catch (e: any) {
      setError(e.message);
      setStep('error');
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleSignIn() {
    // Save tg_id so we can resume after OAuth redirect
    sessionStorage.setItem('tg_connect_id', tgId!);
    router.push(`/login?redirect=/connect/callback?tg_id=${tgId}`);
  }

  if (step === 'loading') return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="text-4xl mb-4">⚡</div>
        <p className="text-gray-400">Loading...</p>
      </div>
    </div>
  );

  if (step === 'error') return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="text-center max-w-sm">
        <div className="text-4xl mb-4">❌</div>
        <p className="text-red-400 mb-4">{error}</p>
        <a href="/" className="text-purple-400 underline">Go to VibeBuild</a>
      </div>
    </div>
  );

  if (step === 'sign-in') return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="text-center max-w-sm">
        <div className="text-5xl mb-4">⚡</div>
        <h1 className="text-2xl font-bold mb-2">Connect Telegram</h1>
        <p className="text-gray-400 mb-6">
          Sign in to VibeBuild to link your Telegram account and start building apps from the bot.
        </p>
        <button
          onClick={handleSignIn}
          className="w-full bg-purple-600 hover:bg-purple-700 text-white font-semibold py-3 px-6 rounded-xl transition"
        >
          Sign in to VibeBuild
        </button>
      </div>
    </div>
  );

  if (step === 'generating') return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="text-4xl mb-4">🔗</div>
        <p className="text-gray-400">Generating your code...</p>
      </div>
    </div>
  );

  // done
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="text-center max-w-sm">
        <div className="text-5xl mb-4">✅</div>
        <h1 className="text-2xl font-bold mb-2">Almost there!</h1>
        <p className="text-gray-400 mb-6">
          Copy this code and paste it in the Telegram bot to complete linking your account.
        </p>
        <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 mb-4">
          <div className="text-4xl font-mono font-bold tracking-widest text-purple-400 mb-4">{code}</div>
          <button
            onClick={handleCopy}
            className="w-full bg-purple-600 hover:bg-purple-700 text-white font-semibold py-3 px-6 rounded-xl transition"
          >
            {copied ? '✅ Copied!' : 'Copy Code'}
          </button>
        </div>
        <p className="text-xs text-gray-500">This code expires in 10 minutes</p>
      </div>
    </div>
  );
}
