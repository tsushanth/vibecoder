// In-memory stand-in for vibe.auth, vibe.db, vibe.storage, vibe.pay and vibe.notify, used only by the headless browser check so that a generated app is
// never failed for a network error and never talks to the real proxy. installFake runs INSIDE the page (it is serialised with
// toString), so it must stay self-contained: no imports, no references to anything outside its own body.
// It follows the behaviour contract the generator is taught (lib/vibe.js VIBE_RULES): signIn resolves, user() is a signed-in
// user, db starts empty and keeps what the app writes, storage returns ids, and the same bad requests are rejected.
export function installFake(w) {
    var v = w.vibe = w.vibe || {};
    var fail = function (msg, status, code) { var e = new Error('vibe: ' + msg); e.status = status; e.code = code; return e; };
    var user = { id: 'check-user-1', email: 'check@example.test' };
    var signedIn = true;
    var listeners = [];
    var notify = function (u) { listeners.slice().forEach(function (fn) { try { fn(u); } catch (e) { /* a listener must not break the others */ } }); };
    v.auth = {
        signIn: function (email) {
            return Promise.resolve().then(function () {
                if (typeof email !== 'string' || !email.trim()) throw fail('vibe.auth.signIn(email): email must be a non-empty string', 0, 'bad_request');
                return { ok: true };
            });
        },
        user: function () { return Promise.resolve(signedIn ? { id: user.id, email: user.email } : null); },
        signOut: function () { signedIn = false; notify(null); return Promise.resolve({ ok: true }); },
        onChange: function (fn) {
            if (typeof fn !== 'function') return function () {};
            listeners.push(fn);
            return function () { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
        },
        ready: Promise.resolve(null)
    };

    var tables = {};
    var seq = 0;
    var IMPLICIT = ['id', 'user_id', 'created_at'];
    var match = function (row, filters) {
        return (filters || []).every(function (f) {
            var a = row[f.col], b = f.val;
            switch (f.op) {
                case 'eq': return a === b;
                case 'neq': return a !== b;
                case 'gt': return a > b;
                case 'gte': return a >= b;
                case 'lt': return a < b;
                case 'lte': return a <= b;
                case 'in': return b.indexOf(a) >= 0;
                case 'like': case 'ilike': return String(a).indexOf(String(b).replace(/%/g, '')) >= 0;
                case 'is_null': return a === null || a === undefined;
                default: return false;
            }
        });
    };
    var OPS = ['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'like', 'ilike', 'in', 'is_null'];
    var copy = function (r) { return JSON.parse(JSON.stringify(r)); };
    var checkWhere = function (where, required) {
        if (where === undefined && !required) return [];
        if (!Array.isArray(where) || (required && !where.length)) throw fail('where must be ' + (required ? 'a non-empty ' : 'an ') + 'array of { col, op, val }', 0, 'bad_request');
        where.forEach(function (f) {
            if (!f || typeof f.col !== 'string' || typeof f.op !== 'string') throw fail('each where entry needs a col and an op', 0, 'bad_request');
            if (OPS.indexOf(f.op) < 0) throw fail('bad operator "' + f.op.slice(0, 12) + '"; use one of ' + OPS.join(', '), 400, 'bad_operator');
            if (f.op === 'in' && !Array.isArray(f.val)) throw fail('in needs an array value', 400, 'bad_request');
        });
        return where;
    };
    var checkSet = function (obj) {
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw fail('rows must be plain objects', 0, 'bad_request');
        IMPLICIT.forEach(function (k) { if (Object.prototype.hasOwnProperty.call(obj, k)) throw fail('"' + k + '" is set by the platform and cannot be sent', 400, 'bad_request'); });
    };
    v.db = {
        from: function (name) {
            if (typeof name !== 'string' || !name) throw fail('vibe.db.from(table): table must be a non-empty string', 0, 'bad_request');
            var rows = tables[name] = tables[name] || [];
            var q = function (fn) { return Promise.resolve().then(fn); };
            return {
                select: function (o) {
                    return q(function () {
                        o = o || {};
                        var w1 = checkWhere(o.where, false);
                        var out = rows.filter(function (r) { return match(r, w1); });
                        (o.order || []).slice().reverse().forEach(function (ord) {
                            var sign = ord.dir === 'desc' ? -1 : 1;
                            out.sort(function (a, b) { return a[ord.col] === b[ord.col] ? 0 : (a[ord.col] > b[ord.col] ? sign : -sign); });
                        });
                        out = out.slice(o.offset || 0);
                        out = out.slice(0, typeof o.limit === 'number' ? Math.min(o.limit, 100) : 50);
                        return { rows: out.map(copy) };
                    });
                },
                insert: function (rowOrRows) {
                    return q(function () {
                        var list = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
                        if (!list.length || list.length > 50) throw fail('insert: pass one row object or an array of 1 to 50 rows', 0, 'bad_request');
                        list.forEach(checkSet);
                        var made = list.map(function (r) {
                            seq += 1;
                            var row = copy(r);
                            row.id = 'check-row-' + seq; row.user_id = user.id; row.created_at = new Date(1767225600000 + seq * 1000).toISOString();
                            rows.push(row);
                            return copy(row);
                        });
                        return { rows: made, count: made.length };
                    });
                },
                update: function (set, where) {
                    return q(function () {
                        checkSet(set);
                        if (!Object.keys(set).length) throw fail('update: set must not be empty', 0, 'bad_request');
                        var w2 = checkWhere(where, true);
                        var hit = rows.filter(function (r) { return match(r, w2); });
                        hit.forEach(function (r) { Object.keys(set).forEach(function (k) { r[k] = set[k]; }); });
                        return { rows: hit.map(copy), count: hit.length };
                    });
                },
                delete: function (where) {
                    return q(function () {
                        var w3 = checkWhere(where, true);
                        var gone = [];
                        for (var i = rows.length - 1; i >= 0; i--) if (match(rows[i], w3)) gone.push({ id: rows.splice(i, 1)[0].id });
                        return { rows: gone, count: gone.length };
                    });
                }
            };
        }
    };

    // vibe.pay: checkout resolves with a Stripe-looking url and NEVER navigates (the real SDK would), orders is empty. Same input rules as the SDK.
    v.pay = {
        checkout: function (o) {
            return Promise.resolve().then(function () {
                o = o || {};
                if (typeof o.item !== 'string' || !o.item) throw fail('vibe.pay.checkout({item}): item must be a catalog item id', 0, 'bad_request');
                var q = o.quantity === undefined ? 1 : o.quantity;
                if (typeof q !== 'number' || q !== Math.floor(q) || q < 1) throw fail('vibe.pay.checkout: quantity must be a whole number of at least 1', 0, 'bad_request');
                return { url: 'https://checkout.stripe.com/c/pay/cs_test_check', mode: 'test' };
            });
        },
        orders: function () {
            return Promise.resolve().then(function () {
                if (!signedIn) throw fail('vibe.pay.orders: sign in first', 401, 'unauthorized');
                return [];
            });
        }
    };

    // vibe.notify: only ever "emails" the signed-in user; the limits are the server's (subject 120, text 2000).
    v.notify = {
        me: function (o) {
            return Promise.resolve().then(function () {
                if (!o || typeof o !== 'object' || typeof o.subject !== 'string' || !o.subject.trim() || typeof o.text !== 'string' || !o.text.trim()) throw fail('vibe.notify.me({subject, text}): subject and text must be non-empty strings', 0, 'bad_request');
                if (!signedIn) throw fail('vibe.notify.me: the user must be signed in', 401, 'unauthorized');
                if (o.subject.length > 120 || o.text.length > 2000) throw fail('subject must be at most 120 and text at most 2000 characters', 400, 'invalid_content');
                return { ok: true };
            });
        }
    };

    var files = [];
    var TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'audio/mpeg', 'text/plain'];
    var PIXEL = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
    v.storage = {
        upload: function (file) {
            return Promise.resolve().then(function () {
                if (!file || typeof file.size !== 'number') throw fail('vibe.storage.upload(file): pass a File or Blob', 0, 'bad_request');
                if (TYPES.indexOf(String(file.type).toLowerCase()) < 0) throw fail('this file type is not allowed', 415, 'type_not_allowed');
                if (file.size > 5 * 1024 * 1024) throw fail('file is too large (max 5 MB)', 413, 'file_too_large');
                var rec = { id: 'check-file-' + (files.length + 1), name: String(file.name || 'file'), contentType: file.type, bytes: file.size };
                files.push(rec);
                return copy(rec);
            });
        },
        list: function () { return Promise.resolve(files.map(copy)); },
        url: function (id) {
            return Promise.resolve().then(function () {
                if (!files.some(function (f) { return f.id === id; })) throw fail('file not found', 404, 'not_found');
                return PIXEL;
            });
        },
        remove: function (id) {
            return Promise.resolve().then(function () {
                var i = files.findIndex(function (f) { return f.id === id; });
                if (i < 0) throw fail('file not found', 404, 'not_found');
                files.splice(i, 1);
                return { ok: true };
            });
        }
    };
}

/** Script text to append to the real vibe.js in a check run: it replaces auth, db and storage with the in-memory fake. */
export const FAKE_SCRIPT = `\n;(${installFake.toString()})(window);\n`;

// In-memory stand-in for vibe.device, for the headless check: every call resolves a harmless value and nothing touches a camera, a
// position or the network. Same argument rules as the SDK. Self-contained for the same reason as installFake.
export function installDeviceFake(w) {
    var v = w.vibe = w.vibe || {};
    var fail = function (msg) { var e = new Error('vibe.device: ' + msg); e.status = 0; e.code = 'bad_request'; return e; };
    var KINDS = ['light', 'medium', 'heavy', 'success', 'warning', 'error'];
    var isInt = function (n, lo, hi) { return typeof n === 'number' && isFinite(n) && Math.floor(n) === n && n >= lo && n <= hi; };
    var opts = function (o) { return o === undefined || (o !== null && typeof o === 'object' && !Array.isArray(o)); };
    var q = function (fn) { return Promise.resolve().then(fn); };
    var GIF = [71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 0, 0, 0, 44, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 0, 59];
    v.device = {
        isNative: function () { return false; },
        camera: {
            capture: function (o) {
                return q(function () {
                    if (!opts(o)) throw fail('camera.capture(options): options must be an object');
                    o = o || {};
                    if (o.facing !== undefined && o.facing !== 'environment' && o.facing !== 'user') throw fail('camera.capture: facing must be "environment" or "user"');
                    if (o.maxBytes !== undefined && !isInt(o.maxBytes, 1, 10485760)) throw fail('camera.capture: maxBytes must be an integer 1..10485760');
                    if (o.timeoutMs !== undefined && !isInt(o.timeoutMs, 1000, 900000)) throw fail('camera.capture: timeoutMs must be an integer 1000..900000');
                    var bytes = new Uint8Array(GIF);
                    return { blob: new Blob([bytes], { type: 'image/gif' }), type: 'image/gif', size: bytes.length, name: 'photo.gif' };
                });
            }
        },
        geolocation: {
            get: function (o) {
                return q(function () {
                    if (!opts(o)) throw fail('geolocation.get(options): options must be an object');
                    o = o || {};
                    if (o.highAccuracy !== undefined && typeof o.highAccuracy !== 'boolean') throw fail('geolocation.get: highAccuracy must be a boolean');
                    if (o.timeoutMs !== undefined && !isInt(o.timeoutMs, 1000, 60000)) throw fail('geolocation.get: timeoutMs must be an integer 1000..60000');
                    if (o.maxAgeMs !== undefined && !isInt(o.maxAgeMs, 0, 600000)) throw fail('geolocation.get: maxAgeMs must be an integer 0..600000');
                    return { lat: 37.7749, lng: -122.4194, accuracy: 25, timestamp: 1767225600000 };
                });
            }
        },
        share: function (o) {
            return q(function () {
                if (o === null || typeof o !== 'object' || Array.isArray(o)) throw fail('share({title, text, url}): options must be an object');
                var keys = Object.keys(o);
                for (var i = 0; i < keys.length; i++) if (keys[i] !== 'title' && keys[i] !== 'text' && keys[i] !== 'url') throw fail('share: unknown option');
                if (o.title !== undefined && (typeof o.title !== 'string' || !o.title || o.title.length > 200)) throw fail('share: title must be a string of 1 to 200 characters');
                if (o.text !== undefined && (typeof o.text !== 'string' || !o.text || o.text.length > 2000)) throw fail('share: text must be a string of 1 to 2000 characters');
                if (o.url !== undefined && (typeof o.url !== 'string' || o.url.length > 2000 || !/^https?:\/\/[^\s]+$/i.test(o.url))) throw fail('share: url must be an http(s) URL');
                if (o.title === undefined && o.text === undefined && o.url === undefined) throw fail('share: give at least one of title, text, url');
                return { shared: true, copied: false };
            });
        },
        haptics: {
            tap: function (kind) {
                return q(function () {
                    if (typeof kind !== 'string' || KINDS.indexOf(kind) < 0) throw fail('haptics.tap(kind): kind must be one of ' + KINDS.join(', '));
                    return { ok: true };
                });
            }
        }
    };
}

export const DEVICE_FAKE_SCRIPT = `\n;(${installDeviceFake.toString()})(window);\n`;
