// Import FIRST in any test that loads code touching config/database.js.
// Points supabase at a dead local port so nothing can reach a real database.
process.env.SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_ANON_KEY = 'test-anon-key';
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
process.env.WORKER_SECRET = 'test-worker-secret';
process.env.WORKER_URL = 'http://worker.test:3456'; // non-loopback so tests can intercept it
process.env.NODE_ENV = 'test';
