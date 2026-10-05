// Process entry point for the vibe-proxy Fly app. Everything testable lives in config.js and start.js.
import { loadConfig } from './config.js';
import { startServer } from './start.js';

let config;
try { config = loadConfig(process.env); } catch (e) { console.error(`vibe-proxy: ${e.message}`); process.exit(1); }

let app;
try { app = await startServer(config); } catch (e) { console.error(`vibe-proxy: ${e.message}`); process.exit(1); }
console.log(JSON.stringify({ ts: new Date().toISOString(), event: 'started', port: app.port, baseDomain: config.baseDomain }));

let stopping = false;
async function stop(signal) {
    if (stopping) return;
    stopping = true;
    console.log(JSON.stringify({ ts: new Date().toISOString(), event: 'stopping', signal }));
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    try { await app.close(); } finally { process.exit(0); }
}
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));
process.on('unhandledRejection', (e) => console.error('vibe-proxy: unhandled rejection', String(e?.message || e).slice(0, 200)));
