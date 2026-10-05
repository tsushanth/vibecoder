/* vibe.pay: browser SDK block for creator-keyed Stripe checkout. ES5, self-contained, NOT a standalone file.
 *
 * HOW TO SPLICE INTO platform/sdk/vibe.js
 *   1. Paste everything between the BEGIN and END markers below inside the vibe.js IIFE, anywhere after the `post` and
 *      `getToken` helpers are defined and before the `window.vibe = {...}` line. It only uses the closure helpers
 *      post(kind, payload, token), getToken() and fail(msg, status, code); it declares one new variable, `pay`.
 *   2. Add `pay: pay` to the exported object: window.vibe = { version: '1', api: api, ai: {...}, auth: {...}, pay: pay };
 *   3. Add the two lines of API docs to the header comment of vibe.js (see the DOC lines at the end of this comment).
 *   platform/pay/test/sdk-snippet.test.mjs splices this file into the real vibe.js the same way and exercises it.
 *
 * DOC lines for the vibe.js header:
 *   vibe.pay.checkout({item:'pro', quantity:1})  -> redirects to Stripe Checkout; resolves {url, mode} ('test' or 'live')
 *   vibe.pay.orders()                            -> the signed-in user's own paid orders [{sessionId,itemId,quantity,amountCents,currency,status,createdAt}]
 * Options for checkout: redirect:false (return the url without navigating), successPath/cancelPath: a path on the app such as '/thanks'.
 * Only a catalog item id and a quantity are sent: price, currency and name always come from the app's catalog on the server.
 * After payment the user returns to the app with ?vibe_pay=success&session_id=... (or ?vibe_pay=cancel).
 */
/* BEGIN vibe.pay */
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
/* END vibe.pay */
