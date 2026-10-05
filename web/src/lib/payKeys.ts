// Stripe key entry for apps that sell things: pure helpers behind the "API keys" panel. An app whose manifest has a pay catalog
// runs on the creator's OWN Stripe account, so the panel asks for their secret key and the signing secret of the webhook they
// register in Stripe. Nothing here sees a stored key (keys are write-only); the format check only looks at what is being pasted,
// and never keeps, logs or returns it. The format check (stripeKeyProblem) and the URL check (safeWebhookUrl) live in secrets.ts,
// next to the code that uses them; this file has no value imports so node can run it directly in tests.
import type { SecretsData } from './secrets';

export type PayHelpKey = 'secrets.pay.secretKeyHelp' | 'secrets.pay.webhookSecretHelp';

export function payHelpKey(name: string): PayHelpKey | null {
  if (name === 'STRIPE_SECRET_KEY') return 'secrets.pay.secretKeyHelp';
  if (name === 'STRIPE_WEBHOOK_SECRET') return 'secrets.pay.webhookSecretHelp';
  return null;
}

/** The strings the pay part of the panel reads; keep in sync with SecretsPanel.tsx. */
export const PAY_UI_KEYS = ['secrets.pay.secretKeyHelp', 'secrets.pay.webhookSecretHelp', 'secrets.pay.testFirst', 'secrets.pay.webhookUrlLabel', 'secrets.pay.webhookUrlPending', 'secrets.pay.copyUrl'] as const;

/** What to show above the Stripe rows, or null when the app does not sell anything (no required key belongs to the pay connector). */
export function paySection(data: SecretsData): { webhookUrl: string | null; names: string[] } | null {
  const names = data.required.filter((r) => r.connectors.includes('pay')).map((r) => r.name);
  return names.length ? { webhookUrl: data.pay?.webhookUrl ?? null, names } : null;
}
