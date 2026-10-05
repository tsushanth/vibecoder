/* PROTOTYPE (throwaway, not wired into platform/sdk/vibe.js): vibe.device fallback layer.
 * ES5, no dependencies. create(win) returns the device object; in a page it is attached as vibe.device.
 *   device.isNative()                          -> boolean
 *   device.camera.capture({facing,maxWidth,quality}) -> Promise<{dataUrl,mimeType,size}>
 *   device.geolocation.get({highAccuracy,timeoutMs,maxAgeMs}) -> Promise<{lat,lng,accuracy,timestamp}>
 *   device.share({title,text,url})             -> Promise<{shared:boolean,copied:boolean}>
 *   device.haptics.tap(kind)                   -> Promise<{ok:boolean}>  (best effort, never rejects for lack of hardware)
 * Errors reject with Error having .status = 0 and .code in:
 *   bad_request | cancelled | denied | unsupported | timeout | unavailable
 * Native calls go through window.Capacitor.Plugins.<Name> (present only inside the APK).
 */
(function (root) {
  var KINDS = ['light', 'medium', 'heavy', 'success', 'warning', 'error'];
  var PATTERNS = { light: 10, medium: 20, heavy: 40, success: [10, 30, 10], warning: [20, 40, 20], error: [40, 30, 40, 30, 40] };
  var MAX_PHOTO_BYTES = 8 * 1024 * 1024;

  function fail(msg, code) { var e = new Error(msg); e.status = 0; e.code = code; return e; }
  function bad(msg) { return Promise.reject(fail('vibe.device.' + msg, 'bad_request')); }
  function isInt(n, lo, hi) { return typeof n === 'number' && isFinite(n) && Math.floor(n) === n && n >= lo && n <= hi; }
  function isObj(o) { return o === undefined || (o !== null && typeof o === 'object' && !Array.isArray(o)); }
  function str(s, max) { return typeof s === 'string' && s.length > 0 && s.length <= max; }
  function safeUrl(u) { return typeof u === 'string' && u.length <= 2000 && /^https?:\/\/[^\s]+$/i.test(u); }

  // Map a Capacitor plugin rejection onto our small error vocabulary.
  function mapNative(e) {
    var m = String((e && (e.message || e)) || '');
    if (/cancel/i.test(m)) return fail('cancelled by user', 'cancelled');
    if (/denied|permission/i.test(m)) return fail('permission denied', 'denied');
    if (/timeout|timed out/i.test(m)) return fail('timed out', 'timeout');
    if (/not implemented|not available|unimplemented/i.test(m)) return fail('not available on this device', 'unavailable');
    return fail('device error', 'unavailable');
  }

  function create(win) {
    function cap() { return win.Capacitor; }
    function isNative() {
      var c = cap();
      try { return !!(c && typeof c.isNativePlatform === 'function' && c.isNativePlatform() === true); } catch (e) { return false; }
    }
    // Unverified on a device: whether Capacitor.Plugins.<Name> exists without a bundler, or only
    // Capacitor.registerPlugin(name). Try both; absent means the web fallback runs.
    function plugin(name) {
      if (!isNative()) return null;
      var c = cap();
      if (c.Plugins && c.Plugins[name]) return c.Plugins[name];
      try { if (typeof c.registerPlugin === 'function') return c.registerPlugin(name) || null; } catch (e) { /* fall through */ }
      return null;
    }

    var camera = {
      capture: function (o) {
        if (!isObj(o)) return bad('camera.capture(options): options must be an object');
        o = o || {};
        var facing = o.facing === undefined ? 'environment' : o.facing;
        var maxWidth = o.maxWidth === undefined ? 1280 : o.maxWidth;
        var quality = o.quality === undefined ? 80 : o.quality;
        if (facing !== 'environment' && facing !== 'user') return bad('camera.capture: facing must be "environment" or "user"');
        if (!isInt(maxWidth, 64, 4096)) return bad('camera.capture: maxWidth must be an integer 64..4096');
        if (!isInt(quality, 1, 100)) return bad('camera.capture: quality must be an integer 1..100');
        var p = plugin('Camera');
        if (p) {
          return p.getPhoto({ quality: quality, width: maxWidth, resultType: 'dataUrl', source: 'CAMERA', direction: facing === 'user' ? 'FRONT' : 'REAR', correctOrientation: true, saveToGallery: false })
            .then(function (r) {
              if (!r || typeof r.dataUrl !== 'string') throw fail('camera returned no image', 'unavailable');
              var m = /^data:([^;,]+)/.exec(r.dataUrl);
              return { dataUrl: r.dataUrl, mimeType: m ? m[1] : 'image/jpeg', size: Math.floor((r.dataUrl.length - r.dataUrl.indexOf(',') - 1) * 3 / 4) };
            }, function (e) { throw mapNative(e); });
        }
        var doc = win.document;
        if (!doc || typeof doc.createElement !== 'function' || !win.FileReader) return Promise.reject(fail('camera not supported here', 'unsupported'));
        return new Promise(function (resolve, reject) {
          var input = doc.createElement('input');
          input.type = 'file'; input.accept = 'image/*'; input.setAttribute('capture', facing === 'user' ? 'user' : 'environment');
          var done = false;
          function once(fn, v) { if (!done) { done = true; fn(v); } }
          input.addEventListener('cancel', function () { once(reject, fail('cancelled by user', 'cancelled')); });
          input.addEventListener('change', function () {
            var f = input.files && input.files[0];
            if (!f) return once(reject, fail('cancelled by user', 'cancelled'));
            if (!/^image\//.test(f.type || '')) return once(reject, fail('not an image', 'bad_request'));
            if (f.size > MAX_PHOTO_BYTES) return once(reject, fail('image larger than 8 MB', 'bad_request'));
            var rd = new win.FileReader();
            rd.onload = function () { once(resolve, { dataUrl: rd.result, mimeType: f.type, size: f.size }); };
            rd.onerror = function () { once(reject, fail('could not read image', 'unavailable')); };
            rd.readAsDataURL(f);
          });
          input.click();
        });
      }
    };

    var geolocation = {
      get: function (o) {
        if (!isObj(o)) return bad('geolocation.get(options): options must be an object');
        o = o || {};
        var hi = o.highAccuracy === undefined ? false : o.highAccuracy;
        var t = o.timeoutMs === undefined ? 15000 : o.timeoutMs;
        var age = o.maxAgeMs === undefined ? 60000 : o.maxAgeMs;
        if (typeof hi !== 'boolean') return bad('geolocation.get: highAccuracy must be a boolean');
        if (!isInt(t, 1000, 60000)) return bad('geolocation.get: timeoutMs must be an integer 1000..60000');
        if (!isInt(age, 0, 600000)) return bad('geolocation.get: maxAgeMs must be an integer 0..600000');
        function shape(pos) { var c = pos && pos.coords; if (!c) throw fail('no position', 'unavailable'); return { lat: c.latitude, lng: c.longitude, accuracy: c.accuracy, timestamp: pos.timestamp }; }
        var p = plugin('Geolocation');
        var opts = { enableHighAccuracy: hi, timeout: t, maximumAge: age };
        if (p) return p.getCurrentPosition(opts).then(shape, function (e) { throw mapNative(e); });
        var nav = win.navigator;
        if (!nav || !nav.geolocation) return Promise.reject(fail('geolocation not supported here', 'unsupported'));
        return new Promise(function (resolve, reject) {
          nav.geolocation.getCurrentPosition(function (pos) { try { resolve(shape(pos)); } catch (e) { reject(e); } }, function (err) {
            var code = err && err.code;
            reject(code === 1 ? fail('permission denied', 'denied') : code === 3 ? fail('timed out', 'timeout') : fail('position unavailable', 'unavailable'));
          }, opts);
        });
      }
    };

    function share(o) {
      if (o === null || typeof o !== 'object' || Array.isArray(o)) return bad('share(options): options must be an object');
      var keys = Object.keys(o);
      for (var i = 0; i < keys.length; i++) if (keys[i] !== 'title' && keys[i] !== 'text' && keys[i] !== 'url') return bad('share: unknown option "' + keys[i] + '"');
      if (o.title !== undefined && !str(o.title, 200)) return bad('share: title must be a string up to 200 chars');
      if (o.text !== undefined && !str(o.text, 2000)) return bad('share: text must be a string up to 2000 chars');
      if (o.url !== undefined && !safeUrl(o.url)) return bad('share: url must be an http(s) URL up to 2000 chars');
      if (o.title === undefined && o.text === undefined && o.url === undefined) return bad('share: give at least one of title, text, url');
      var p = plugin('Share');
      if (p) return p.share({ title: o.title, text: o.text, url: o.url }).then(function () { return { shared: true, copied: false }; }, function (e) {
        if (/cancel/i.test(String((e && e.message) || ''))) return { shared: false, copied: false };
        throw mapNative(e);
      });
      var nav = win.navigator;
      if (nav && typeof nav.share === 'function') {
        return nav.share(o).then(function () { return { shared: true, copied: false }; }, function (e) {
          if (e && e.name === 'AbortError') return { shared: false, copied: false };
          throw fail('share failed', 'unavailable');
        });
      }
      var clip = nav && nav.clipboard;
      if (clip && typeof clip.writeText === 'function') {
        var txt = [o.title, o.text, o.url].filter(function (x) { return x !== undefined; }).join('\n');
        return clip.writeText(txt).then(function () { return { shared: false, copied: true }; }, function () { throw fail('share not supported here', 'unsupported'); });
      }
      return Promise.reject(fail('share not supported here', 'unsupported'));
    }

    var haptics = {
      tap: function (kind) {
        if (KINDS.indexOf(kind) < 0) return bad('haptics.tap(kind): kind must be one of ' + KINDS.join(', '));
        var p = plugin('Haptics');
        if (p) {
          var call = /^(light|medium|heavy)$/.test(kind) ? p.impact({ style: kind.toUpperCase() }) : p.notification({ type: kind.toUpperCase() });
          return call.then(function () { return { ok: true }; }, function () { return { ok: false }; });
        }
        var nav = win.navigator;
        var ok = false;
        try { ok = !!(nav && typeof nav.vibrate === 'function' && nav.vibrate(PATTERNS[kind])); } catch (e) { ok = false; }
        return Promise.resolve({ ok: ok });
      }
    };

    return { isNative: isNative, camera: camera, geolocation: geolocation, share: share, haptics: haptics };
  }

  var api = { create: create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && root.window === root) { root.vibe = root.vibe || {}; root.vibe.device = create(root); }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
