// The app's event recorder, bound to the service-role database client.
// Under NODE_ENV=test nothing is written unless APP_EVENTS_TEST is set, so unrelated tests never touch a database.
import { supabase } from '../config/database.js';
import { createAppEvents } from './appEvents.js';
import { createBuildEvents } from './buildEvents.js';

const enabled = () => process.env.APP_EVENTS_ENABLED !== 'false' && (process.env.NODE_ENV !== 'test' || !!process.env.APP_EVENTS_TEST);

export const appEvents = createAppEvents({ getClient: () => supabase, enabled });
export const buildEvents = createBuildEvents({ emit: appEvents.emit, getClient: () => supabase });
export { sourceFromRequest } from './appEvents.js';
