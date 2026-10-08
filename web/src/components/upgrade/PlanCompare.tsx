'use client';

import { useTranslations } from 'next-intl';
import { SUBSCRIPTION_TIERS } from '@/lib/constants';
import { cn } from '@/lib/utils';

const FREE = SUBSCRIPTION_TIERS.free;
const PRO = SUBSCRIPTION_TIERS.pro;
/** "$9.99/mo" -> "$9.99": the amount is the product's, the period is translated */
export const PRO_AMOUNT = PRO.price.split('/')[0];
const FREE_AMOUNT = FREE.price.split('/')[0];

type Cell = string | boolean;

function Check({ on, label }: { on: boolean; label: string }) {
  return on ? (
    <svg className="mx-auto h-5 w-5 text-accent-hover" fill="none" stroke="currentColor" strokeWidth={2.4} viewBox="0 0 24 24" role="img" aria-label={label}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  ) : (
    <span className="mx-auto block h-px w-3 bg-subtle" role="img" aria-label={label} />
  );
}

/**
 * Free against Pro, row by row, from the product's own limits (lib/constants and the server's tier table). The Pro column is one
 * violet band running the height of the table: the one thing to look at on this screen.
 */
export function PlanCompare() {
  const t = useTranslations('account.upgrade');
  const rows: { label: string; free: Cell; pro: Cell }[] = [
    { label: t('rowTweaks'), free: String(FREE.tweaksPerProject), pro: t('unlimited') },
    { label: t('rowPrivate'), free: FREE.canCreatePrivateProjects, pro: PRO.canCreatePrivateProjects },
    { label: t('rowDomains'), free: false, pro: true },
  ];

  const value = (c: Cell, pro: boolean) =>
    typeof c === 'boolean' ? (
      <Check on={c} label={c ? t('included') : t('notIncluded')} />
    ) : (
      <span className={cn('text-[15px] tabular-nums', pro ? 'font-semibold text-foreground' : 'text-muted')}>{c}</span>
    );

  return (
    <table className="w-full table-fixed border-separate border-spacing-0 text-left">
      <colgroup>
        <col />
        <col className="w-[76px] sm:w-[120px]" />
        <col className="w-[112px] sm:w-[168px]" />
      </colgroup>
      <thead>
        <tr>
          <th scope="col" className="pb-4 align-bottom">
            <span className="sr-only">{t('feature')}</span>
          </th>
          <th scope="col" className="px-2 pb-4 pt-5 text-center align-bottom font-normal">
            <span className="block text-[15px] font-semibold text-muted">{t('free')}</span>
            <span className="mt-1 block font-display text-[22px] font-bold text-muted sm:text-[26px]">{FREE_AMOUNT}</span>
          </th>
          <th scope="col" className="rounded-t-xl bg-accent/15 px-2 pb-4 pt-5 text-center align-bottom font-normal">
            <span className="block text-[15px] font-semibold text-accent-hover">{t('pro')}</span>
            <span className="mt-1 block font-display text-[30px] font-extrabold leading-none text-foreground sm:text-[38px]">{PRO_AMOUNT}</span>
            <span className="mt-1 block text-[13px] text-muted">{t('perMonth')}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const end = i === rows.length - 1;
          return (
            <tr key={r.label}>
              <th scope="row" className="border-t border-border py-3.5 pr-2 text-[15px] font-normal leading-snug text-foreground">
                {r.label}
              </th>
              <td className="border-t border-border px-2 py-3.5 text-center">{value(r.free, false)}</td>
              <td className={cn('border-t border-accent/25 bg-accent/15 px-2 py-3.5 text-center', end && 'rounded-b-xl')}>{value(r.pro, true)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
