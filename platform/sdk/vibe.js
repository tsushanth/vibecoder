/* vibe.js - call approved APIs and AI from a VibeBuild app without any API key.
 *   vibe.api('nws', '/points/39.7,-97.1')          -> parsed JSON (or text)
 *   vibe.api(name, path, {method, query, body})
 *   vibe.ai.chat([{role:'user', content:'hi'}])    -> {text, usage}
 *   vibe.ai.ask('one question', {system:'...'})    -> text
 *   vibe.auth.signIn('a@b.com')                    -> emails a one-time sign-in link (resolves {ok:true})
 *   vibe.auth.user()                               -> {id, email} or null when signed out
 *   vibe.auth.signOut()                            -> clears the session
 *   vibe.auth.onChange(function (user) {})         -> called after sign-in or sign-out
 *   vibe.auth.ready                                -> Promise that settles once a sign-in link in the URL has been handled
 *   vibe.db.from('todos').select()                 -> the server's JSON (50 rows by default; no arguments = all columns, no filter)
 *   vibe.db.from('todos').select({where:[{col:'done', op:'eq', val:false}], order:[{col:'created_at', dir:'desc'}], limit:20, offset:0, columns:['id','title']})
 *       where ops: eq neq lt lte gt gte like ilike in is_null (conditions are ANDed, max 10). limit max 100.
 *   vibe.db.from('todos').insert({title:'x'})      -> one row, or an array of up to 50 rows
 *   vibe.db.from('todos').update({done:true}, [{col:'id', op:'eq', val:id}])   -> where is required
 *   vibe.db.from('todos').delete([{col:'id', op:'eq', val:id}])                -> where is required
 *   Tables and columns come from the app's vibe.schema.json; id, user_id and created_at are added to every row by the platform
 *   and cannot be written. Who may read or write a table follows its access rule; signed-in calls send the session automatically.
 *   vibe.storage.upload(file, {public}) / list() / url(id) / remove(id)   -> files for signed-in users (5 MB; images, pdf, mp3, text)
 *   vibe.pay.checkout({item:'pro', quantity:1}) -> redirects to Stripe Checkout; vibe.pay.orders() -> the signed-in user's orders
 * All calls return Promises. Errors reject with Error: err.status (0 = network/timeout), err.code, err.retryAfter (seconds).
 * Keys never live in the app: the platform adds them server-side. Only connectors declared in the app manifest or built in work.
 * Config for custom domains: window.VIBE_APP_ID, window.VIBE_BASE, window.VIBE_TIMEOUT_MS.
 */
(function () {
  var BASE = window.VIBE_BASE || 'https://vibe-proxy.vibebuild.cc';
  var host = location.hostname;
  var appId = window.VIBE_APP_ID || (/\.vibebuild\.cc$/.test(host) ? host.replace(/\.vibebuild\.cc$/, '') : null);

  function fail(msg, status, code, retryAfter) {
    var e = new Error(msg);
    e.status = status; e.code = code;
    if (retryAfter != null) e.retryAfter = retryAfter;
    return e;
  }

  var TOKEN_KEY = 'vibe:session:' + appId;
  var memToken = null;
  var listeners = [];
  function getToken() {
    try { var t = window.localStorage && window.localStorage.getItem(TOKEN_KEY); if (t) return t; } catch (e) { /* storage blocked */ }
    return memToken;
  }
  function setToken(t) {
    memToken = t;
    try {
      if (!window.localStorage) return;
      if (t) window.localStorage.setItem(TOKEN_KEY, t); else window.localStorage.removeItem(TOKEN_KEY);
    } catch (e) { /* storage blocked: the in-memory copy still works for this page */ }
  }
  function notify(user) { listeners.slice().forEach(function (fn) { try { fn(user); } catch (e) { /* a listener must not break the others */ } }); }

  function post(kind, payload, token, raw) {
    if (!appId) return Promise.reject(fail('vibe: app id unknown (set window.VIBE_APP_ID for custom domains)', 0, 'no_app_id'));
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, window.VIBE_TIMEOUT_MS || 40000);
    var headers = { 'Content-Type': raw ? raw.type : 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    return fetch(BASE + '/' + encodeURIComponent(appId) + '/' + kind + (raw ? raw.query : ''), {
      method: 'POST',
      headers: headers,
      body: raw ? raw.body : JSON.stringify(payload),
      signal: ctrl.signal
    }).then(function (r) {
      var json = /json/i.test(r.headers.get('content-type') || '');
      return (json ? r.json().catch(function () { return {}; }) : r.text()).then(function (data) {
        if (!r.ok) {
          var ra = parseInt(r.headers.get('retry-after'), 10);
          throw fail((data && data.error) || ('vibe HTTP ' + r.status), r.status, (data && data.error) || 'http_' + r.status, isNaN(ra) ? null : ra);
        }
        return data;
      });
    }, function (e) {
      throw e && e.name === 'AbortError' ? fail('vibe: request timed out', 0, 'timeout') : fail('vibe: network error', 0, 'network');
    }).then(function (v) { clearTimeout(timer); return v; }, function (e) { clearTimeout(timer); throw e; });
  }

  function api(connector, path, o) {
    o = o || {};
    return Promise.resolve().then(function () {
      if (typeof connector !== 'string' || typeof path !== 'string') throw fail('vibe.api(connector, path): both must be strings', 0, 'bad_request');
      var p = { connector: connector, method: String(o.method || 'GET').toUpperCase(), path: path };
      if (o.query && typeof o.query === 'object') p.query = o.query;
      if (o.body !== undefined) p.body = o.body;
      return post('api', p);
    });
  }

  function chat(messages, o) {
    o = o || {};
    return Promise.resolve().then(function () {
      if (!Array.isArray(messages) || !messages.length) throw fail('vibe.ai.chat(messages): messages must be a non-empty array', 0, 'bad_request');
      var p = { messages: messages };
      if (typeof o.maxTokens === 'number') p.maxTokens = o.maxTokens;
      if (typeof o.temperature === 'number') p.temperature = o.temperature;
      return post('ai', p);
    });
  }

  function ask(prompt, o) {
    o = o || {};
    return Promise.resolve().then(function () {
      if (typeof prompt !== 'string' || !prompt.trim()) throw fail('vibe.ai.ask(prompt): prompt must be a non-empty string', 0, 'bad_request');
      var m = [];
      if (o.system) m.push({ role: 'system', content: String(o.system) });
      m.push({ role: 'user', content: prompt });
      return chat(m, o).then(function (r) { return r.text; });
    });
  }

  function signIn(email) {
    return Promise.resolve().then(function () {
      if (typeof email !== 'string' || !email.trim()) throw fail('vibe.auth.signIn(email): email must be a non-empty string', 0, 'bad_request');
      return post('auth/request', { email: email.trim() });
    });
  }

  function user() {
    return Promise.resolve().then(function () {
      var t = getToken();
      if (!t) return null;
      return post('auth/me', {}, t).then(function (r) { return r.user; }, function (e) {
        if (e && e.status === 401) { setToken(null); return null; }
        throw e;
      });
    });
  }

  function signOut() {
    return Promise.resolve().then(function () {
      var t = getToken();
      setToken(null);
      notify(null);
      if (!t) return { ok: true };
      return post('auth/signout', {}, t).then(function () { return { ok: true }; }, function () { return { ok: true }; });
    });
  }

  function onChange(fn) {
    if (typeof fn !== 'function') return function () {};
    listeners.push(fn);
    return function () { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
  }

  // A sign-in link opens the app with ?vibe_login=<token>. Trade it for a session, then remove it from the address bar.
  var linkToken = null;
  try { var m = /[?&]vibe_login=([A-Za-z0-9_-]{20,100})/.exec(location.search || ''); linkToken = m ? m[1] : null; } catch (e) { /* no location */ }
  var ready = Promise.resolve(null);
  if (linkToken && appId) {
    ready = post('auth/consume', { token: linkToken }).then(function (r) {
      setToken(r.token);
      notify(r.user);
      return r.user;
    }, function () { return null; }).then(function (u) {
      try {
        var q = location.search.replace(/([?&])vibe_login=[^&]*&?/, '$1').replace(/[?&]$/, '');
        window.history.replaceState(null, '', location.pathname + q + (location.hash || ''));
      } catch (e) { /* history unavailable */ }
      return u;
    });
  }

  // ---- vibe.db: typed table access. The server checks everything again; these checks only fail fast without a request. ----
  var NAME_RE = /^[a-z][a-z0-9_]{0,40}$/;
  var SELECT_KEYS = ['columns', 'where', 'order', 'limit', 'offset'];
  function isObj(v) { return Object.prototype.toString.call(v) === '[object Object]'; }
  function badArg(msg) { return fail(msg, 0, 'bad_request'); }
  function dbPost(body) {
    // The session token is optional: anonymous reads of public tables work without one.
    return post('db', body, getToken());
  }
  function checkTable(table) {
    if (typeof table !== 'string' || !NAME_RE.test(table)) throw badArg('vibe.db.from(table): table must be a lowercase name such as "todos"');
  }
  function checkWhere(where, what, required) {
    if (where === undefined && !required) return;
    if (!Array.isArray(where) || (required && !where.length)) throw badArg(what + ': where must be ' + (required ? 'a non-empty ' : 'an ') + 'array of {col, op, val}');
    for (var i = 0; i < where.length; i++) if (!isObj(where[i])) throw badArg(what + ': each where entry must be an object {col, op, val}');
  }
  function dbSelect(table, o) {
    return Promise.resolve().then(function () {
      checkTable(table);
      if (o !== undefined && !isObj(o)) throw badArg('select(options): options must be an object');
      o = o || {};
      Object.keys(o).forEach(function (k) { if (SELECT_KEYS.indexOf(k) < 0) throw badArg('select: unknown option "' + k + '" (allowed: ' + SELECT_KEYS.join(', ') + ')'); });
      if (o.columns !== undefined && (!Array.isArray(o.columns) || !o.columns.length)) throw badArg('select: columns must be a non-empty array of names');
      checkWhere(o.where, 'select', false);
      if (o.order !== undefined) {
        if (!Array.isArray(o.order)) throw badArg('select: order must be an array of {col, dir}');
        for (var i = 0; i < o.order.length; i++) if (!isObj(o.order[i])) throw badArg('select: each order entry must be an object {col, dir}');
      }
      if (o.limit !== undefined && typeof o.limit !== 'number') throw badArg('select: limit must be a number');
      if (o.offset !== undefined && typeof o.offset !== 'number') throw badArg('select: offset must be a number');
      var p = { op: 'select', table: table };
      SELECT_KEYS.forEach(function (k) { if (o[k] !== undefined) p[k] = o[k]; });
      return dbPost(p);
    });
  }
  function dbInsert(table, rowOrRows) {
    return Promise.resolve().then(function () {
      checkTable(table);
      var rows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
      if (!rows.length || rows.length > 50) throw badArg('insert: pass one row object or an array of 1 to 50 rows');
      for (var i = 0; i < rows.length; i++) if (!isObj(rows[i])) throw badArg('insert: each row must be an object of column values');
      return dbPost({ op: 'insert', table: table, rows: rows });
    });
  }
  function dbUpdate(table, set, where) {
    return Promise.resolve().then(function () {
      checkTable(table);
      if (!isObj(set) || !Object.keys(set).length) throw badArg('update(set, where): set must be a non-empty object of column values');
      checkWhere(where, 'update(set, where)', true);
      return dbPost({ op: 'update', table: table, set: set, where: where });
    });
  }
  function dbDelete(table, where) {
    return Promise.resolve().then(function () {
      checkTable(table);
      checkWhere(where, 'delete(where)', true);
      return dbPost({ op: 'delete', table: table, where: where });
    });
  }
  function from(table) {
    return {
      select: function (o) { return dbSelect(table, o); },
      insert: function (rowOrRows) { return dbInsert(table, rowOrRows); },
      update: function (set, where) { return dbUpdate(table, set, where); },
      delete: function (where) { return dbDelete(table, where); }
    };
  }

  var PAY_URL = /^https:\/\/checkout\.stripe\.com\//;
  function payCheckout(o) {
    o = o || {};
    return Promise.resolve().then(function () {
      if (typeof o.item !== 'string' || !o.item) throw fail('vibe.pay.checkout({item}): item must be a catalog item id', 0, 'bad_request');
      var q = o.quantity === undefined ? 1 : o.quantity;
      if (typeof q !== 'number' || q !== Math.floor(q) || q < 1) throw fail('vibe.pay.checkout: quantity must be a whole number of at least 1', 0, 'bad_request');
      var p = { item: o.item, quantity: q };
      if (o.successPath !== undefined) p.successPath = o.successPath;
      if (o.cancelPath !== undefined) p.cancelPath = o.cancelPath;
      return post('pay/checkout', p, getToken() || undefined);
    }).then(function (r) {
      if (!r || typeof r.url !== 'string' || !PAY_URL.test(r.url)) throw fail('vibe.pay.checkout: unexpected response', 0, 'bad_response');
      if (o.redirect !== false && typeof location !== 'undefined' && typeof location.assign === 'function') location.assign(r.url);
      return { url: r.url, mode: r.mode };
    });
  }
  function payOrders() {
    return Promise.resolve().then(function () {
      var t = getToken();
      if (!t) throw fail('vibe.pay.orders: sign in first', 401, 'unauthorized');
      return post('pay/orders', {}, t);
    }).then(function (r) { return r.orders; });
  }
  var pay = { checkout: payCheckout, orders: payOrders };

  // ---- vibe.storage: files for signed-in users (png, jpeg, gif, webp, pdf, mp3, plain text; up to 5 MB) ----
  function needToken(what) {
    var t = getToken();
    if (!t) throw fail('vibe.storage.' + what + ': sign in first', 401, 'unauthorized');
    return t;
  }
  function stUpload(file, o) {
    o = o || {};
    return Promise.resolve().then(function () {
      var t = needToken('upload');
      if (!file || typeof file.size !== 'number' || typeof file.type !== 'string' || !file.type) throw fail('vibe.storage.upload(file): pass a File or Blob with a type', 0, 'bad_request');
      if (file.size < 1 || file.size > 5 * 1024 * 1024) throw fail('vibe.storage.upload: files must be between 1 byte and 5 MB', 0, 'bad_request');
      var q = '?name=' + encodeURIComponent(file.name || 'file') + (o.public ? '&public=1' : '');
      return post('storage/upload', null, t, { body: file, type: file.type, query: q });
    }).then(function (r) { return r.file; });
  }
  function stList() {
    return Promise.resolve().then(function () { return post('storage/list', {}, needToken('list')); }).then(function (r) { return r.files; });
  }
  function stUrl(id) {
    return Promise.resolve().then(function () {
      var t = needToken('url');
      if (typeof id !== 'string' || !id) throw fail('vibe.storage.url(id): id must be a file id', 0, 'bad_request');
      return post('storage/url', { id: id }, t);
    }).then(function (r) { return r.url; });
  }
  function stRemove(id) {
    return Promise.resolve().then(function () {
      var t = needToken('remove');
      if (typeof id !== 'string' || !id) throw fail('vibe.storage.remove(id): id must be a file id', 0, 'bad_request');
      return post('storage/delete', { id: id }, t);
    }).then(function () { return { ok: true }; });
  }
  var storage = { upload: stUpload, list: stList, url: stUrl, remove: stRemove };

  window.vibe = { version: '1', api: api, ai: { chat: chat, ask: ask }, auth: { signIn: signIn, user: user, signOut: signOut, onChange: onChange, ready: ready }, db: { from: from }, pay: pay, storage: storage };
})();
