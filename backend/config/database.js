import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const isDevelopment = process.env.NODE_ENV === 'development';

// For local development without Supabase, create a mock client
let supabase;

if (!supabaseUrl || !supabaseKey) {
    if (isDevelopment) {
        console.warn('⚠️  Running in development mode without Supabase - using mock database');
        // Mock Supabase client for local testing
        supabase = {
            from: (table) => ({
                select: () => ({ data: [], error: null }),
                insert: () => ({ data: null, error: null }),
                update: () => ({ data: null, error: null }),
                delete: () => ({ data: null, error: null }),
                eq: () => ({ data: [], error: null }),
                single: () => ({ data: null, error: { code: 'PGRST116' } })
            }),
            rpc: () => ({ data: { success: true, new_balance: 0 }, error: null })
        };
    } else {
        throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables');
    }
} else {
    supabase = createClient(supabaseUrl, supabaseKey);
}

export { supabase };
