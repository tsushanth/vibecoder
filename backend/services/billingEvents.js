// Webhook event log: de-duplication and out-of-order detection for the Stripe and RevenueCat webhooks.
// Backed by the optional table vibebuild_billing_events (supabase/migrations/20261101000000_billing_events.sql). Until that
// migration is applied every function here FAILS SOFT: duplicates are not detected and ordering is not enforced from the log
// (the handlers are idempotent state setters, and RevenueCat rows carry their own ordering marker), and one failure is reported.
import { reportFailure } from '../lib/failureReporter.js';

const TABLE = 'vibebuild_billing_events';
let reportedUnavailable = false;

/** Tests only. */
export function _resetBillingEventsState() { reportedUnavailable = false; }

function missingTable(error) {
    const code = String(error?.code || '');
    const msg = String(error?.message || '');
    return code === '42P01' || code === 'PGRST205' || /does not exist|could not find the table|schema cache/i.test(msg);
}

// Only a MISSING table is worth a report (the migration was not applied). Other errors are transient database trouble: the main
// write of the same request fails and is reported by the webhook itself, so reporting here would only add noise.
function degrade(error) {
    if (reportedUnavailable || !missingTable(error)) return;
    reportedUnavailable = true;
    reportFailure('billing:event_log_unavailable', new Error('Billing event log table is missing'), { code: String(error?.code || '').slice(0, 20) });
}

/** True when this (source, eventId) was already processed. false when unknown or the log is unavailable. */
export async function wasProcessed(supabase, source, eventId) {
    if (!eventId) return false;
    try {
        const { data, error } = await supabase.from(TABLE).select('event_id').eq('source', source).eq('event_id', eventId).maybeSingle();
        if (error) { degrade(error); return false; }
        return !!data;
    } catch (e) { degrade(e); return false; }
}

/** Newest recorded event time (ms) for a subject (a Stripe subscription id), or null. */
export async function latestEventMs(supabase, source, subject) {
    if (!subject) return null;
    try {
        const { data, error } = await supabase.from(TABLE).select('event_created').eq('source', source).eq('subject', subject).not('event_created', 'is', null).order('event_created', { ascending: false }).limit(1);
        if (error) { degrade(error); return null; }
        const t = data?.[0]?.event_created ? new Date(data[0].event_created).getTime() : NaN;
        return Number.isNaN(t) ? null : t;
    } catch (e) { degrade(e); return null; }
}

/** Records a processed event. Never throws: a failed write only means a redelivery is processed again (idempotent). */
export async function recordEvent(supabase, { source, eventId, subject = null, eventType = null, eventCreatedMs = null, outcome = 'applied' }) {
    if (!eventId) return;
    try {
        const { error } = await supabase.from(TABLE).upsert({
            source, event_id: eventId, subject, event_type: eventType,
            event_created: eventCreatedMs ? new Date(eventCreatedMs).toISOString() : null,
            outcome, processed_at: new Date().toISOString(),
        }, { onConflict: 'source,event_id' });
        if (error) degrade(error);
    } catch (e) { degrade(e); }
}
