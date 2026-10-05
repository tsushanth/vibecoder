// PostgreSQL SCRAM-SHA-256 password verifier, computed locally so the plaintext password never reaches the database,
// its logs or a migration history. Use it as: create role x login password '<verifier>'.
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';

const hmac = (key, data) => createHmac('sha256', key).update(data).digest();

export function scramVerifier(password, { iterations = 4096, salt = randomBytes(16) } = {}) {
    if (typeof password !== 'string' || password.length < 16) throw new Error('password must be at least 16 characters');
    if (!Number.isInteger(iterations) || iterations < 4096) throw new Error('iterations must be an integer of at least 4096');
    const salted = pbkdf2Sync(password.normalize('NFKC'), salt, iterations, 32, 'sha256');
    const storedKey = createHash('sha256').update(hmac(salted, 'Client Key')).digest();
    const serverKey = hmac(salted, 'Server Key');
    return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}
