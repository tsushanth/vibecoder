/* Client code for end-user notifications, written to be spliced into platform/sdk/vibe.js as `vibe.notify`.
 *
 * HOW TO SPLICE (three edits in sdk/vibe.js, nothing else):
 *   1. Paste everything between the "BEGIN SNIPPET" and "END SNIPPET" markers below, unchanged, inside the IIFE, after
 *      the auth functions and before the `window.vibe = {` line. It is plain ES5 and defines only `notifyMe` and
 *      `notifyApi`, which do not collide with the existing `notify(user)` helper of the auth listeners.
 *   2. Add `notify: notifyApi` to the object assigned to `window.vibe`.
 *   3. Add this line to the usage comment at the top of vibe.js:
 *        vibe.notify.me({subject, text})   -> emails the SIGNED-IN user at their own address (resolves {ok:true})
 *
 * It relies on four things vibe.js already has in scope: post(kind, payload, token), fail(msg, status, code),
 * getToken() and setToken(t). The snippet's own tests splice it into the real vibe.js, so they fail if those change.
 *
 * Behavior: there is deliberately no way to name a recipient. Only `subject` (<= 120 chars) and `text` (<= 2000 chars,
 * plain text) are sent; the server mails the account holder of the current session and applies limits and opt-outs.
 * Errors reject like the rest of the SDK: err.status, err.code, err.retryAfter. Codes: unauthorized (401, signed out),
 * invalid_content (400, err message is the code; see err.code), rate_limited (429), opted_out (409, the user
 * unsubscribed from this app), app_disabled (403), send_failed (502), notify_unavailable (503).
 */
// ---- BEGIN SNIPPET ----
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
// ---- END SNIPPET ----
