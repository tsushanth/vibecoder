import { test } from "node:test";
import assert from "node:assert/strict";
import { hasInternalSecret, requireInternal } from "../internalAuth.js";

const SECRET = "a-long-random-test-secret-value";
const req = (h) => ({ headers: h });

test("accepts the exact secret", () => assert.equal(hasInternalSecret(req({ "x-internal-secret": SECRET }), SECRET), true));
test("rejects missing, empty and wrong values", () => {
  assert.equal(hasInternalSecret(req({}), SECRET), false);
  assert.equal(hasInternalSecret(req({ "x-internal-secret": "" }), SECRET), false);
  assert.equal(hasInternalSecret(req({ "x-internal-secret": SECRET + "x" }), SECRET), false);
  assert.equal(hasInternalSecret(req({ "x-internal-secret": ["a", "b"] }), SECRET), false);
});
test("an unset server secret never matches", () => assert.equal(hasInternalSecret(req({ "x-internal-secret": "" }), ""), false));
test("middleware answers 401 without the secret and calls next with it", () => {
  const mw = requireInternal(SECRET);
  let status = null, body = null, nexted = false;
  const res = { status(s) { status = s; return this; }, json(b) { body = b; return this; } };
  mw(req({}), res, () => { nexted = true; });
  assert.equal(status, 401); assert.deepEqual(body, { error: "Unauthorized" }); assert.equal(nexted, false);
  mw(req({ "x-internal-secret": SECRET }), res, () => { nexted = true; });
  assert.equal(nexted, true);
});
