import { supabase } from '../config/database.js';
import { createBuildInvariantMonitor } from './buildInvariants.js';

export const buildInvariants = createBuildInvariantMonitor({ supabase });
