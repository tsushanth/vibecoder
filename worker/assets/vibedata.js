/* vibedata.js - persistent shared data for VibeBuild apps.
 * <script src="https://vibecoder-api.fly.dev/api/appdata/sdk.js"></script>  (see docs)
 * All calls return Promises. get() resolves null when missing.
 * Limits: 32KB/value, 1000 keys/app, 5MB/app. Errors reject with Error (err.status set).
 */
(function () {
  var API = (window.VIBEDATA_API || 'https://vibecoder-api.fly.dev') + '/api/appdata/';
  var host = location.hostname;
  var appId = window.VIBEDATA_APP_ID ||
    (/\.vibebuild\.cc$/.test(host) ? host.replace(/\.vibebuild\.cc$/, '') : null);
  function url(c, k) {
    if (!appId) throw new Error('vibedata: app id unknown (set window.VIBEDATA_APP_ID for custom domains)');
    return API + encodeURIComponent(appId) + '/' + encodeURIComponent(c) + (k == null ? '' : '/' + encodeURIComponent(k));
  }
  function req(method, u, body) {
    var opts = { method: method };
    if (body !== undefined) { opts.headers = { 'Content-Type': 'application/json' }; opts.body = JSON.stringify(body); }
    return fetch(u, opts).then(function (r) {
      if (r.status === 404 && method === 'GET') return null;
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.error || ('vibedata HTTP ' + r.status)); e.status = r.status; throw e; }
        return j;
      });
    });
  }
  window.vibedata = {
    get: function (c, k) { return Promise.resolve().then(function () { return req('GET', url(c, k)); }).then(function (j) { return j ? j.value : null; }); },
    set: function (c, k, v) { return Promise.resolve().then(function () { return req('PUT', url(c, k), { value: v }); }).then(function () { return v; }); },
    remove: function (c, k) { return Promise.resolve().then(function () { return req('DELETE', url(c, k)); }).then(function () { return true; }); },
    /* list(collection, {prefix, limit, after}) -> {items:[{key,value,updatedAt}], next} */
    list: function (c, o) {
      o = o || {};
      return Promise.resolve().then(function () {
        var q = [];
        ['prefix', 'limit', 'after'].forEach(function (n) { if (o[n] != null) q.push(n + '=' + encodeURIComponent(o[n])); });
        return req('GET', url(c) + (q.length ? '?' + q.join('&') : ''));
      });
    }
  };
})();
