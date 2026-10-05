/* vibe.js - call approved APIs and AI from a VibeBuild app without any API key.
 *   vibe.api('nws', '/points/39.7,-97.1')          -> parsed JSON (or text)
 *   vibe.api(name, path, {method, query, body})
 *   vibe.ai.chat([{role:'user', content:'hi'}])    -> {text, usage}
 *   vibe.ai.ask('one question', {system:'...'})    -> text
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

  function post(kind, payload) {
    if (!appId) return Promise.reject(fail('vibe: app id unknown (set window.VIBE_APP_ID for custom domains)', 0, 'no_app_id'));
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, window.VIBE_TIMEOUT_MS || 40000);
    return fetch(BASE + '/' + encodeURIComponent(appId) + '/' + kind, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

  window.vibe = { version: '1', api: api, ai: { chat: chat, ask: ask } };
})();
