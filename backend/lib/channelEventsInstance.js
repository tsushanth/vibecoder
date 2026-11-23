// The channel-event recorder bound to the service-role database client.
// Under NODE_ENV=test nothing is written unless CHANNEL_EVENTS_TEST is set.
import { supabase } from '../config/database.js';
import { createChannelEvents } from './telegram/metrics.js';

export const channelEvents = createChannelEvents({
    getClient: () => supabase,
    enabled: () => process.env.CHANNEL_EVENTS_ENABLED !== 'false' && (process.env.NODE_ENV !== 'test' || !!process.env.CHANNEL_EVENTS_TEST),
});
