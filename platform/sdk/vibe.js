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

  function post(kind, payload, token) {
    if (!appId) return Promise.reject(fail('vibe: app id unknown (set window.VIBE_APP_ID for custom domains)', 0, 'no_app_id'));
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, window.VIBE_TIMEOUT_MS || 40000);
    return fetch(BASE + '/' + encodeURIComponent(appId) + '/' + kind, {
      method: 'POST',
      headers: token ? { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token } : { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
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

  window.vibe = { version: '1', api: api, ai: { chat: chat, ask: ask }, auth: { signIn: signIn, user: user, signOut: signOut, onChange: onChange, ready: ready } };
})();
