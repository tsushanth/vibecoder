#!/usr/bin/env node
// Verifies the permissions in a built APK against the exact allow-list of the Capacitor shell.
// Usage: node scripts/check-apk-permissions.mjs <path-to.apk>   (exit 0 = clean, 1 = violation, 2 = could not inspect)
// Reads `aapt2 dump permissions` output; the parser and the rule are exported so tests can feed it fixture text.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REQUIRED_PERMISSIONS = [
    'android.permission.INTERNET',
    'android.permission.CAMERA',
    'android.permission.ACCESS_COARSE_LOCATION',
    'android.permission.ACCESS_FINE_LOCATION',
    'android.permission.VIBRATE',
];

/** Pulls the package, the used permissions and the permissions it defines out of aapt2 (dump permissions or badging) text. */
export function parsePermissions(text) {
    const used = [];
    const defined = [];
    let pkg = null;
    for (const line of String(text).split(/\r?\n/)) {
        let m;
        if ((m = /^package:\s*(?:name=')?([A-Za-z0-9._]+)/.exec(line))) pkg = pkg || m[1];
        else if ((m = /^uses-permission(?:-sdk-(?:\d+|m))?:\s*name='([^']+)'/.exec(line))) used.push(m[1]);
        else if ((m = /^permission:\s*(?:name=')?([A-Za-z0-9._]+)/.exec(line))) defined.push(m[1]);
    }
    return { pkg, used: [...new Set(used)], defined: [...new Set(defined)] };
}

/** Returns {ok, violations[], found[]}. The only allowed permissions are REQUIRED_PERMISSIONS plus AndroidX's own per-app receiver permission. */
export function checkPermissions(text) {
    const { pkg, used, defined } = parsePermissions(text);
    const violations = [];
    if (!pkg) violations.push('could not read the package name');
    const own = pkg ? `${pkg}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` : null;
    for (const p of used) {
        if (REQUIRED_PERMISSIONS.includes(p) || p === own) continue;
        violations.push(`unexpected permission: ${p}`);
    }
    for (const p of defined) if (p !== own) violations.push(`unexpected defined permission: ${p}`);
    for (const p of REQUIRED_PERMISSIONS) if (!used.includes(p)) violations.push(`missing permission: ${p}`);
    return { ok: violations.length === 0, violations, found: used };
}

function compareVersions(a, b) {
    const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
    return 0;
}

/** AAPT2 env var, else the newest build-tools/<v>/aapt2 under ANDROID_HOME (or /opt/android-sdk, or the Mac SDK). */
export function findAapt2(env = process.env) {
    if (env.AAPT2) return env.AAPT2;
    const homes = [env.ANDROID_HOME, env.ANDROID_SDK_ROOT, '/opt/android-sdk', env.HOME && path.join(env.HOME, 'Library/Android/sdk')].filter(Boolean);
    for (const home of homes) {
        const dir = path.join(home, 'build-tools');
        let versions;
        try { versions = fs.readdirSync(dir).filter((v) => /^\d+(\.\d+)*$/.test(v)).sort(compareVersions).reverse(); } catch { continue; }
        for (const v of versions) { const p = path.join(dir, v, 'aapt2'); if (fs.existsSync(p)) return p; }
    }
    return null;
}

/** Runs aapt2 on the APK and returns checkPermissions(). Throws if the APK cannot be inspected (fails closed). */
export function checkApk(apkPath, env = process.env) {
    const aapt2 = findAapt2(env);
    if (!aapt2) throw new Error('aapt2 not found (set AAPT2 or ANDROID_HOME)');
    let out;
    try { out = execFileSync(aapt2, ['dump', 'permissions', apkPath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { throw new Error(`aapt2 could not read the APK: ${String(e.message).split('\n')[0]}`); }
    return checkPermissions(out);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    const apk = process.argv[2];
    if (!apk) { console.error('usage: check-apk-permissions.mjs <apk>'); process.exit(2); }
    try {
        const r = checkApk(apk);
        console.log(`permissions: ${r.found.join(', ')}`);
        if (!r.ok) { for (const v of r.violations) console.error(`FAIL ${v}`); process.exit(1); }
        console.log('OK');
    } catch (e) { console.error(e.message); process.exit(2); }
}
