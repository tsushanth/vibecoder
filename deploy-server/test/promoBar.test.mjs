import test from "node:test";
import assert from "node:assert/strict";
import { promoScript, promoUrl } from "../promoBar.js";

test("both links in the bar carry the utm tags and the app's subdomain as the campaign", () => {
  const html = promoScript("my-app");
  const url = "https://vibebuild.cc/?utm_source=builtwith&utm_medium=app_banner&utm_campaign=my-app";
  assert.equal(html.split(`href="${url}"`).length - 1, 2);
  assert.ok(!html.includes('href="https://vibebuild.cc"'));
});

test("a subdomain that is not a plain label cannot inject into the link", () => {
  for (const bad of ['a"><script>', "x y", "A_B", "", undefined, null, "a".repeat(64), "../x"]) {
    assert.ok(promoUrl(bad).endsWith("utm_campaign=app"), String(bad));
  }
  assert.ok(promoUrl("shop-2").endsWith("utm_campaign=shop-2"));
});

test("the report link and the body padding are still there", () => {
  const html = promoScript("x");
  assert.match(html, /mailto:abuse@/);
  assert.match(html, /padding-bottom:44px/);
});
