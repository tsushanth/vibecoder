// In-memory stand-in for vibe.auth, vibe.db and vibe.storage, used only by the headless browser check so that a generated app is
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
