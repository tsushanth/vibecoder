import { supabase } from '../config/database.js';
import { createFailureRateMonitor } from './buildFailureRate.js';

/** Shared monitor, so the cleanup cron and the server's own interval share one 6-hour throttle. */
export const buildFailureRate = createFailureRateMonitor({ supabase });
