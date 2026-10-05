import test from "node:test";
import assert from "node:assert/strict";
import { injectAppId } from "../appId.js";

test("puts the app id script right after <head>, so it runs before the SDK", () => {
  const out = injectAppId("<html><head><title>x</title></head><body></body></html>", "my-app");
  assert.equal(out, '<html><head><script>window.VIBE_APP_ID="my-app";</script><title>x</title></head><body></body></html>');
});

test("handles a head tag with attributes and any letter case", () => {
  assert.match(injectAppId('<HEAD lang="en"><meta></HEAD>', "my-app"), /^<HEAD lang="en"><script>window\.VIBE_APP_ID="my-app";<\/script><meta>/);
});

test("falls back to prepending when there is no head", () => {
  assert.equal(injectAppId("<p>hi</p>", "my-app"), '<script>window.VIBE_APP_ID="my-app";</script><p>hi</p>');
});

test("leaves the html untouched for an invalid subdomain, so nothing unsafe is ever inlined", () => {
  for (const bad of ['a"</script><script>x', "../x", "A-b", "x", "", undefined, null, 5]) assert.equal(injectAppId("<head></head>", bad), "<head></head>", String(bad));
});

test("non-string html is returned as is", () => {
  assert.equal(injectAppId(undefined, "my-app"), undefined);
});
