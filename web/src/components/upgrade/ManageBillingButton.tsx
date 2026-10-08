'use client';

import { useTranslations } from 'next-intl';
import { useManageBilling } from './useManageBilling';

/** "Manage subscription": opens Stripe's portal, and says plainly when there is nothing to manage on the web or billing is unavailable. */
export function ManageBillingButton({ className, label, wrapperClassName = 'items-start' }: { className: string; label: string; wrapperClassName?: string }) {
  const t = useTranslations('account.upgrade');
  const { state, open } = useManageBilling();
  return (
    <div className={`flex flex-col gap-2 ${wrapperClassName}`}>
      <button type="button" onClick={open} disabled={state === 'opening'} className={`${className} disabled:opacity-60`}>
        {state === 'opening' ? t('manageOpening') : label}
      </button>
      {(state === 'none' || state === 'failed') && (
        <p role="alert" className="max-w-[44ch] text-[14px] text-danger">
          {state === 'none' ? t('manageNone') : t('manageFailed')}
        </p>
      )}
    </div>
  );
}
