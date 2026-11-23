import Link from 'next/link';
import { telegramBotUrl } from '@/lib/telegramBot';

const POINTS = [
  { title: 'Any language', detail: 'Write your idea the way you speak. The bot answers in your language (26 are supported).' },
  { title: 'No download', detail: 'Works inside Telegram on any phone or computer. Open the chat and describe an app.' },
  { title: 'Same account', detail: 'Connect your VibeBuild account with /link and every app shows up in the app and on the web.' },
];

/** "Build from Telegram" block of the landing page: what it is, and a button that opens the bot with a start payload for attribution. */
export function TelegramSection() {
  return (
    <section id="telegram" className="scroll-mt-16 border-t border-border px-5 py-20 sm:px-6">
      <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[1fr_1fr]">
        <div>
          <h2 className="font-display text-3xl font-bold sm:text-4xl">Build from Telegram</h2>
          <p className="mt-4 max-w-[32rem] text-lg leading-relaxed text-muted">
            Message <span className="font-semibold text-foreground">@Vibebuilder_bot</span> an idea. About two minutes later you get a live link to your app, right in the chat.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <a
              href={telegramBotUrl('web_home')}
              target="_blank"
              rel="noopener"
              className="rounded-lg bg-accent px-7 py-3.5 text-base font-semibold text-white transition hover:bg-accent-hover"
            >
              Open in Telegram
            </a>
            <Link href="/connect" className="text-sm text-muted underline transition hover:text-foreground">Connect your account</Link>
          </div>
        </div>
        <ul className="grid gap-6">
          {POINTS.map((p) => (
            <li key={p.title}>
              <h3 className="font-display text-lg font-semibold">{p.title}</h3>
              <p className="mt-1 text-[15px] leading-relaxed text-muted">{p.detail}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
