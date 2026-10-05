// Reads a shared secret from the environment and refuses to start without a usable one: never a built-in default.
// Keep this file identical in backend/lib, worker/lib, deploy-server and build-monitor (each deploys on its own).
import { createHash } from 'node:crypto';

// SHA-256 of values that must never be used again. Hashes only: the values themselves are not kept.
export const KNOWN_PUBLIC_SECRET_HASHES = [
    '3024ad19fe18385835f8d6f92e7dd6699a3d3c2a08e3bf70168c4f7879f71819',
    '43e8a53c191fb79d7160e49d75ce9e52e30de4af92cb4005ff6c20f816c78ba7',
];

const MIN_LENGTH = 16;

export function requireSecret(name, env = process.env, { publicHashes = KNOWN_PUBLIC_SECRET_HASHES } = {}) {
    const value = env[name];
    if (typeof value !== 'string' || !value.trim() || value.length < MIN_LENGTH) {
        throw new Error(`${name} must be set to a unique random value of at least ${MIN_LENGTH} characters`);
    }
    if (publicHashes.includes(createHash('sha256').update(value).digest('hex'))) {
        throw new Error(`${name} is set to a retired value that must not be used; set a new random value`);
    }
    return value;
}
