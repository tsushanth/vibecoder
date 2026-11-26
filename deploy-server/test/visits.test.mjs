import { test } from "node:test";
import assert from "node:assert/strict";
import { BEACON_SCRIPT, OWNER_COOKIE, createVisitCounter, injectBeacon, isBotUserAgent, isOwnerToken, ownerMac } from "../visits.js";

const CHROME = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
const SECRET = "shared-test-secret";
const HOST = "my-app.vibebuild.cc";

const request = (headers = {}) => ({ headers: { host: HOST, origin: `https://${HOST}`, "sec-fetch-site": "same-origin", "user-agent": CHROME, "fly-client-ip": "203.0.113.7", ...headers }, socket: {} });
const response = () => { const r = { headers: {}, code: 0, location: null, setHeader(k, v) { r.headers[k] = v; }, status(c) { r.code = c; return r; }, end() {}, redirect(c, to) { r.code = c; r.location = to; } }; return r; };

function setup(opts = {}) {
  let t = Date.parse("2026-12-01T10:00:00Z");
  const saved = []; const results = [];
  const c = createVisitCounter({ record: async (s) => { saved.push(s); return { error: null }; }, secret: SECRET, onResult: (e) => results.push(e), now: () => t, ...opts });
  const hit = async (headers, sub = "my-app", host = HOST) => { const res = response(); await c.handleBeacon(request(headers), res, sub, host); return res; };
  return { c, saved, results, hit, forward: (ms) => { t += ms; }, time: () => t };
}

test("a person's page load is one visit; reloads within 30 minutes are not another", async () => {
  const s = setup();
  assert.equal((await s.hit()).code, 204);
  await s.hit();
  assert.deepEqual(s.saved, ["my-app"]);
  s.forward(31 * 60_000);
  await s.hit();
  await s.hit({ "fly-client-ip": "203.0.113.8" });
  assert.equal(s.saved.length, 3);
});

test("bots, the VibeBuild app, other origins and unknown hosts are not counted", async () => {
  const s = setup();
  const bots = ["", "curl/8.4.0", "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", "Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/130.0 Safari/537.36",
    "facebookexternalhit/1.1", "WhatsApp/2.23.1 A", "Mozilla/5.0 (compatible; GPTBot/1.0)", "Slackbot-LinkExpanding 1.0", "python-requests/2.31"];
  for (const ua of bots) { assert.equal(isBotUserAgent(ua), true, ua); await s.hit({ "user-agent": ua }); }
  assert.equal(isBotUserAgent(CHROME), false);
  assert.equal(isBotUserAgent("Mozilla/5.0 (Linux; Android 11; CUBOT X30) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36"), false);
  await s.hit({ "user-agent": `${CHROME} VibeBuildApp` });
  await s.hit({ "x-requested-with": "com.kreativekoala.vibecoder" });
  await s.hit({ origin: "https://evil.example" });
  await s.hit({ origin: undefined });
  await s.hit({ "sec-fetch-site": "cross-site" });
  await s.hit({}, null);
  assert.deepEqual(s.saved, []);
});

test("one address cannot add more than 30 visits a day to one app", async () => {
  const s = setup();
  for (let i = 0; i < 50; i++) await s.hit({ "user-agent": `${CHROME} v${i}` });
  assert.equal(s.saved.length, 30);
  s.forward(24 * 60 * 60_000);
  await s.hit();
  assert.equal(s.saved.length, 31);
});

test("the creator's signed link sets a host-only cookie, redirects to the clean address, and is then not counted", async () => {
  const s = setup();
  const exp = Math.floor(s.time() / 1000) + 3600;
  const token = `${exp}.${ownerMac(SECRET, "my-app", exp)}`;
  const res = response();
  assert.equal(s.c.handleOwnerLink({ originalUrl: `/play?level=2&vb_own=${token}`, headers: {} }, res, "my-app"), true);
  assert.equal(res.code, 302);
  assert.equal(res.location, "/play?level=2");
  assert.match(res.headers["Set-Cookie"], /^__Host-vb_own=1; Path=\/; Max-Age=\d+; Secure; HttpOnly; SameSite=Lax$/);
  await s.hit({ cookie: `a=b; ${OWNER_COOKIE}=1` });
  assert.deepEqual(s.saved, []);
  assert.equal(s.c.handleOwnerLink({ originalUrl: "/", headers: {} }, response(), "my-app"), false);
});

test("a wrong, expired or borrowed signature sets nothing, and the redirect cannot leave the site", () => {
  const s = setup();
  const now = Math.floor(s.time() / 1000);
  assert.equal(isOwnerToken(SECRET, "my-app", `${now + 60}.${ownerMac(SECRET, "my-app", now + 60)}`, s.time()), true);
  for (const [sub, token] of [["other-app", `${now + 60}.${ownerMac(SECRET, "my-app", now + 60)}`], ["my-app", `${now - 1}.${ownerMac(SECRET, "my-app", now - 1)}`], ["my-app", `${now + 999}.${ownerMac(SECRET, "my-app", now + 60)}`], ["my-app", "junk"]]) {
    const res = response();
    assert.equal(s.c.handleOwnerLink({ originalUrl: `//evil.example/x?vb_own=${token}`, headers: {} }, res, sub), true);
    assert.equal(res.headers["Set-Cookie"], undefined);
    assert.equal(res.location, "/evil.example/x");
  }
  const res = response();
  s.c.handleOwnerLink({ originalUrl: "/\\evil.example?vb_own=x", headers: {} }, res, "my-app");
  assert.equal(res.location, "/evil.example");
});

// The same vector is checked in backend/test/unit/visits.test.mjs: the two sides must agree.
test("owner link signature matches the API", () => {
  assert.equal(`1800000000.${ownerMac(SECRET, "my-app", 1800000000)}`, "1800000000.8fvb4gcmfibqGkGhBO_4ncfq7sio-9v1");
});

test("a failed save is passed on and never reaches the visitor", async () => {
  const s = setup({ record: async () => ({ error: { code: "42883" } }) });
  assert.equal((await s.hit()).code, 204);
  assert.deepEqual(s.results, [{ code: "42883" }]);
  const t = setup({ record: async () => { throw new Error("down"); } });
  assert.equal((await t.hit()).code, 204);
  assert.equal(t.results.length, 1);
});

test("the beacon goes just before </body>, and its script parses", () => {
  assert.equal(injectBeacon("<body><p></p></body></html>"), `<body><p></p>${BEACON_SCRIPT}</body></html>`);
  assert.equal(injectBeacon("<p></p>"), `<p></p>${BEACON_SCRIPT}`);
  const js = BEACON_SCRIPT.replace(/^<script>|<\/script>$/g, "");
  const run = ({ framed = false, webdriver = false, state = "visible" } = {}) => {
    const sent = []; const listeners = [];
    const window = {}; window.self = window; window.top = framed ? {} : window;
    const document = { visibilityState: state, addEventListener: (_e, f) => listeners.push(f) };
    new Function("window", "document", "navigator", js)(window, document, { webdriver, sendBeacon: (p) => sent.push(p) });
    return { sent, show: () => { document.visibilityState = "visible"; listeners.forEach((f) => f()); } };
  };
  const seen = run(); seen.show();
  assert.deepEqual(seen.sent, ["/__vb/visit"]);
  assert.deepEqual(run({ framed: true }).sent, []);
  assert.deepEqual(run({ webdriver: true }).sent, []);
  const hidden = run({ state: "hidden" });
  assert.deepEqual(hidden.sent, []);
  hidden.show();
  assert.deepEqual(hidden.sent, ["/__vb/visit"]);
});
