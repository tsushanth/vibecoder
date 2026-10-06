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
 *   vibe.notify.me({subject, text}) -> emails the signed-in user themself (never anyone else), rate-limited
 *   vibe.device.isNative()                          -> true only inside an exported Android app (use for UI hints only; every call below works on the web too)
 *   vibe.device.camera.capture({facing, maxBytes, timeoutMs}) -> {blob, type, size, name}; blob is a File/Blob you can pass to vibe.storage.upload (max 5 MB by default)
 *   vibe.device.geolocation.get({highAccuracy, timeoutMs, maxAgeMs}) -> {lat, lng, accuracy, timestamp} (timeoutMs default 15000)
 *   vibe.device.share({title, text, url}) -> {shared, copied}; falls back to copying to the clipboard, rejects 'unsupported' if neither works
 *   vibe.device.haptics.tap('light'|'medium'|'heavy'|'success'|'warning'|'error') -> {ok}; best effort, never rejects for missing hardware
 *   Device errors reject with err.status 0 and err.code: bad_request | unsupported | denied | cancelled | timeout | unavailable. The user may always deny or cancel.
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

  function notifyMe(o) {
    return Promise.resolve().then(function () {
      if (!o || typeof o !== 'object' || typeof o.subject !== 'string' || !o.subject.trim() || typeof o.text !== 'string' || !o.text.trim()) {
        throw fail('vibe.notify.me({subject, text}): subject and text must be non-empty strings', 0, 'bad_request');
      }
      var t = getToken();
      if (!t) throw fail('vibe.notify.me: the user must be signed in', 401, 'unauthorized');
      return post('notify/me', { subject: o.subject, text: o.text }, t).then(function (r) { return { ok: true }; }, function (e) {
        if (e && e.status === 401) setToken(null);
        throw e;
      });
    });
  }
  var notifyApi = { me: notifyMe };
  // vibe.device: camera, location, share and haptics. Web fallbacks use the standard browser APIs; inside an exported
  // Capacitor APK the native plugins are used when present, and anything unimplemented falls back to the web path.
  // Errors reject with Error: err.status 0 and err.code in bad_request | unsupported | denied | cancelled | timeout | unavailable.
  var DEV_KINDS = ['light', 'medium', 'heavy', 'success', 'warning', 'error'];
  var DEV_PATTERNS = { light: 10, medium: 20, heavy: 40, success: [10, 30, 10], warning: [20, 40, 20], error: [40, 30, 40, 30, 40] };
  var DEV_MB = 1024 * 1024;

  function devBad(msg) { return Promise.reject(fail('vibe.device.' + msg, 0, 'bad_request')); }
  function devInt(n, lo, hi) { return typeof n === 'number' && isFinite(n) && Math.floor(n) === n && n >= lo && n <= hi; }
  function devOpts(o) { return o === undefined || (o !== null && typeof o === 'object' && !Array.isArray(o)); }
  function devStr(s, max) { return typeof s === 'string' && s.length > 0 && s.length <= max; }
  function devUrl(u) { return typeof u === 'string' && u.length <= 2000 && /^https?:\/\/[^\s]+$/i.test(u); }
  function devMsg(e) { return String((e && (e.message || e)) || ''); }
  function devUnimplemented(e) { return /not implemented|not available|unimplemented/i.test(devMsg(e)); }
  function devMap(e) {
    var m = devMsg(e);
    if (/cancel/i.test(m)) return fail('vibe.device: cancelled by the user', 0, 'cancelled');
    if (/denied|permission/i.test(m)) return fail('vibe.device: permission denied', 0, 'denied');
    if (/timeout|timed out/i.test(m)) return fail('vibe.device: timed out', 0, 'timeout');
    return fail('vibe.device: the device could not do that', 0, 'unavailable');
  }
  function devNative() {
    var c = window.Capacitor;
    try { return !!(c && typeof c.isNativePlatform === 'function' && c.isNativePlatform() === true); } catch (e) { return false; }
  }
  function devPlugin(name) {
    if (!devNative()) return null;
    var c = window.Capacitor;
    if (c.Plugins && c.Plugins[name]) return c.Plugins[name];
    try { if (typeof c.registerPlugin === 'function') return c.registerPlugin(name) || null; } catch (e) { /* fall through to the web path */ }
    return null;
  }
  // Run the native plugin when there is one; no plugin, or one the APK does not implement, runs the web path instead.
  function devVia(name, call, onOk, web, onErr) {
    var p = devPlugin(name);
    if (!p) return web();
    var r;
    try { r = Promise.resolve(call(p)); } catch (e) { r = Promise.reject(e); }
    return r.then(onOk, function (e) {
      if (devUnimplemented(e)) return web();
      if (onErr) return onErr(e);
      throw devMap(e);
    });
  }
  // A call that waits on the person or a browser prompt can stay pending forever; settle it with code "timeout" after ms.
  function devGuard(promise, ms, what) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { reject(fail('vibe.device.' + what + ' timed out', 0, 'timeout')); }, ms);
      promise.then(function (v) { clearTimeout(timer); resolve(v); }, function (e) { clearTimeout(timer); reject(e); });
    });
  }
  function devBlobFromDataUrl(url, maxBytes) {
    var comma = typeof url === 'string' ? url.indexOf(',') : -1;
    var m = comma > 0 ? /^data:(image\/[A-Za-z0-9.+-]+);base64$/.exec(url.slice(0, comma)) : null;
    if (!m) throw fail('vibe.device.camera.capture: the camera returned no usable image', 0, 'unavailable');
    var b64 = url.slice(comma + 1);
    var size = Math.floor(b64.length * 3 / 4) - (/==$/.test(b64) ? 2 : /=$/.test(b64) ? 1 : 0);
    if (size > maxBytes) throw fail('vibe.device.camera.capture: the image is larger than maxBytes (' + maxBytes + ')', 0, 'bad_request');
    try {
      var bin = atob(b64), bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      var ext = m[1] === 'image/png' ? 'png' : m[1] === 'image/webp' ? 'webp' : 'jpg';
      return { blob: new Blob([bytes], { type: m[1] }), type: m[1], size: bytes.length, name: 'photo.' + ext };
    } catch (e) { throw fail('vibe.device.camera.capture: the camera returned no usable image', 0, 'unavailable'); }
  }

  function devCapture(o) {
    if (!devOpts(o)) return devBad('camera.capture(options): options must be an object');
    o = o || {};
    var facing = o.facing === undefined ? 'environment' : o.facing;
    var maxWidth = o.maxWidth === undefined ? 1280 : o.maxWidth;
    var quality = o.quality === undefined ? 80 : o.quality;
    var maxBytes = o.maxBytes === undefined ? 5 * DEV_MB : o.maxBytes;
    var timeoutMs = o.timeoutMs === undefined ? 300000 : o.timeoutMs;
    if (facing !== 'environment' && facing !== 'user') return devBad('camera.capture: facing must be "environment" or "user"');
    if (!devInt(maxWidth, 64, 4096)) return devBad('camera.capture: maxWidth must be an integer 64..4096 (native camera only)');
    if (!devInt(quality, 1, 100)) return devBad('camera.capture: quality must be an integer 1..100 (native camera only)');
    if (!devInt(maxBytes, 1, 10 * DEV_MB)) return devBad('camera.capture: maxBytes must be an integer 1..10485760');
    if (!devInt(timeoutMs, 1000, 900000)) return devBad('camera.capture: timeoutMs must be an integer 1000..900000');
    function web() {
      var doc = window.document;
      if (!doc || typeof doc.createElement !== 'function') return Promise.reject(fail('vibe.device.camera.capture: not supported here', 0, 'unsupported'));
      return new Promise(function (resolve, reject) {
        var input = doc.createElement('input');
        input.type = 'file'; input.accept = 'image/*'; input.setAttribute('capture', facing);
        var done = false;
        function once(fn, v) { if (!done) { done = true; fn(v); } }
        input.addEventListener('cancel', function () { once(reject, fail('vibe.device.camera.capture: cancelled by the user', 0, 'cancelled')); });
        input.addEventListener('change', function () {
          var f = input.files && input.files[0];
          if (!f) return once(reject, fail('vibe.device.camera.capture: cancelled by the user', 0, 'cancelled'));
          if (!/^image\//.test(f.type || '')) return once(reject, fail('vibe.device.camera.capture: the chosen file is not an image', 0, 'bad_request'));
          if (f.size > maxBytes) return once(reject, fail('vibe.device.camera.capture: the image is larger than maxBytes (' + maxBytes + ')', 0, 'bad_request'));
          once(resolve, { blob: f, type: f.type, size: f.size, name: f.name || 'photo' });
        });
        try { input.click(); } catch (e) { once(reject, fail('vibe.device.camera.capture: not supported here', 0, 'unsupported')); }
      });
    }
    return devGuard(devVia('Camera', function (p) {
      return p.getPhoto({ quality: quality, width: maxWidth, resultType: 'dataUrl', source: 'CAMERA', direction: facing === 'user' ? 'FRONT' : 'REAR', correctOrientation: true, saveToGallery: false });
    }, function (r) { return devBlobFromDataUrl(r && r.dataUrl, maxBytes); }, web), timeoutMs, 'camera.capture');
  }

  function devLocate(o) {
    if (!devOpts(o)) return devBad('geolocation.get(options): options must be an object');
    o = o || {};
    var hi = o.highAccuracy === undefined ? false : o.highAccuracy;
    var t = o.timeoutMs === undefined ? 15000 : o.timeoutMs;
    var age = o.maxAgeMs === undefined ? 60000 : o.maxAgeMs;
    if (typeof hi !== 'boolean') return devBad('geolocation.get: highAccuracy must be a boolean');
    if (!devInt(t, 1000, 60000)) return devBad('geolocation.get: timeoutMs must be an integer 1000..60000');
    if (!devInt(age, 0, 600000)) return devBad('geolocation.get: maxAgeMs must be an integer 0..600000');
    var opts = { enableHighAccuracy: hi, timeout: t, maximumAge: age };
    function shape(pos) {
      var c = pos && pos.coords;
      if (!c) throw fail('vibe.device.geolocation.get: no position', 0, 'unavailable');
      return { lat: c.latitude, lng: c.longitude, accuracy: c.accuracy, timestamp: pos.timestamp };
    }
    function web() {
      var nav = window.navigator;
      if (!nav || !nav.geolocation) return Promise.reject(fail('vibe.device.geolocation.get: not supported here', 0, 'unsupported'));
      return new Promise(function (resolve, reject) {
        nav.geolocation.getCurrentPosition(function (pos) { try { resolve(shape(pos)); } catch (e) { reject(e); } }, function (err) {
          var code = err && err.code;
          reject(code === 1 ? fail('vibe.device.geolocation.get: permission denied', 0, 'denied') : code === 3 ? fail('vibe.device.geolocation.get: timed out', 0, 'timeout') : fail('vibe.device.geolocation.get: position unavailable', 0, 'unavailable'));
        }, opts);
      });
    }
    // The browser timeout does not cover a permission prompt left open, so a guard timer settles the call shortly after it.
    return devGuard(devVia('Geolocation', function (p) { return p.getCurrentPosition(opts); }, shape, web), t + 2000, 'geolocation.get');
  }

  function devShare(o) {
    if (o === null || typeof o !== 'object' || Array.isArray(o)) return devBad('share({title, text, url}): options must be an object');
    var keys = Object.keys(o);
    for (var i = 0; i < keys.length; i++) if (keys[i] !== 'title' && keys[i] !== 'text' && keys[i] !== 'url') return devBad('share: unknown option "' + String(keys[i]).slice(0, 20) + '"');
    if (o.title !== undefined && !devStr(o.title, 200)) return devBad('share: title must be a string of 1 to 200 characters');
    if (o.text !== undefined && !devStr(o.text, 2000)) return devBad('share: text must be a string of 1 to 2000 characters');
    if (o.url !== undefined && !devUrl(o.url)) return devBad('share: url must be an http(s) URL of at most 2000 characters');
    if (o.title === undefined && o.text === undefined && o.url === undefined) return devBad('share: give at least one of title, text, url');
    var payload = {};
    if (o.title !== undefined) payload.title = o.title;
    if (o.text !== undefined) payload.text = o.text;
    if (o.url !== undefined) payload.url = o.url;
    function copyOr(err) {
      var nav = window.navigator, clip = nav && nav.clipboard;
      if (clip && typeof clip.writeText === 'function') {
        var txt = [o.title, o.text, o.url].filter(function (x) { return x !== undefined; }).join('\n');
        return clip.writeText(txt).then(function () { return { shared: false, copied: true }; }, function () { throw err; });
      }
      return Promise.reject(err);
    }
    function web() {
      var nav = window.navigator;
      if (nav && typeof nav.share === 'function') {
        var r;
        try { r = Promise.resolve(nav.share(payload)); } catch (e) { r = Promise.reject(e); }
        return r.then(function () { return { shared: true, copied: false }; }, function (e) {
          if (e && e.name === 'AbortError') return { shared: false, copied: false };
          return copyOr(e && e.name === 'NotAllowedError' ? fail('vibe.device.share: sharing needs a tap or click', 0, 'denied') : fail('vibe.device.share: sharing failed', 0, 'unavailable'));
        });
      }
      return copyOr(fail('vibe.device.share: not supported here', 0, 'unsupported'));
    }
    return devVia('Share', function (p) { return p.share(payload); }, function () { return { shared: true, copied: false }; }, web, function (e) {
      if (/cancel/i.test(devMsg(e))) return { shared: false, copied: false };
      throw devMap(e);
    });
  }

  function devTap(kind) {
    if (typeof kind !== 'string' || DEV_KINDS.indexOf(kind) < 0) return devBad('haptics.tap(kind): kind must be one of ' + DEV_KINDS.join(', '));
    function web() {
      var nav = window.navigator, ok = false;
      try { ok = !!(nav && typeof nav.vibrate === 'function' && nav.vibrate(DEV_PATTERNS[kind])); } catch (e) { ok = false; }
      return Promise.resolve({ ok: ok });
    }
    return devVia('Haptics', function (p) {
      return /^(light|medium|heavy)$/.test(kind) ? p.impact({ style: kind.toUpperCase() }) : p.notification({ type: kind.toUpperCase() });
    }, function () { return { ok: true }; }, web, function () { return { ok: false }; });
  }
  var device = { isNative: devNative, camera: { capture: devCapture }, geolocation: { get: devLocate }, share: devShare, haptics: { tap: devTap } };
  window.vibe = { version: '1', api: api, ai: { chat: chat, ask: ask }, auth: { signIn: signIn, user: user, signOut: signOut, onChange: onChange, ready: ready }, db: { from: from }, pay: pay, storage: storage, notify: notifyApi, device: device };
})();
