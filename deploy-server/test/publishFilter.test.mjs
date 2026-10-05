import test from "node:test";
import assert from "node:assert/strict";
import { stripPrivateFiles } from "../publishFilter.js";

const f = (name) => ({ name, data: Buffer.from("x") });

test("the connector manifest is not published, at the root or in any folder, in any letter case", () => {
  const out = stripPrivateFiles([f("index.html"), f("vibe.manifest.json"), f("app/vibe.manifest.json"), f("VIBE.Manifest.JSON"), f("a\\vibe.manifest.json")]);
  assert.deepEqual(out.map((x) => x.name), ["index.html"]);
});

test("ordinary files are untouched, including names that merely resemble the manifest", () => {
  const names = ["index.html", "vibe.js", "manifest.json", "my-vibe.manifest.json", "vibe.manifest.json.bak", "data/vibe.manifest.jsonl", "vibe-manifest.json"];
  assert.deepEqual(stripPrivateFiles(names.map(f)).map((x) => x.name), names);
});

test("does not mutate its input and tolerates odd entries", () => {
  const input = [f("vibe.manifest.json"), f("index.html")];
  stripPrivateFiles(input);
  assert.equal(input.length, 2);
  assert.deepEqual(stripPrivateFiles([null, undefined, {}, f("index.html")]).filter((x) => x?.name).map((x) => x.name), ["index.html"]);
});
