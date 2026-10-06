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

test("the table schema is not published, at the root or in any folder, in any letter case", () => {
  const out = stripPrivateFiles([f("index.html"), f("vibe.schema.json"), f("app/vibe.schema.json"), f("VIBE.Schema.JSON"), f("a\\vibe.schema.json")]);
  assert.deepEqual(out.map((x) => x.name), ["index.html"]);
});

test("names that merely resemble the schema file are published", () => {
  const names = ["schema.json", "my-vibe.schema.json", "vibe.schema.json.bak", "data/vibe.schema.jsonl", "vibe-schema.json", "vibe.schemas.json", "vibe.schema.js"];
  assert.deepEqual(stripPrivateFiles(names.map(f)).map((x) => x.name), names);
});

test("the scheduled-jobs file is not published, at the root or in any folder, in any letter case", () => {
  const out = stripPrivateFiles([f("index.html"), f("vibe.jobs.json"), f("app/vibe.jobs.json"), f("VIBE.Jobs.JSON"), f("a\\vibe.jobs.json")]);
  assert.deepEqual(out.map((x) => x.name), ["index.html"]);
});

test("names that merely resemble the jobs file are published", () => {
  const names = ["jobs.json", "my-vibe.jobs.json", "vibe.jobs.json.bak", "data/vibe.jobs.jsonl", "vibe-jobs.json", "vibe.job.json", "vibe.jobs.js"];
  assert.deepEqual(stripPrivateFiles(names.map(f)).map((x) => x.name), names);
});

test("the three private files go together and nothing else new is stripped", () => {
  const names = ["index.html", "style.css", "app.js", "vibe.js", "vibe.pay.json", "vibe.notify.json", "vibe.config.json", "vibe.env", "vibe.secrets.json"];
  const out = stripPrivateFiles([...names.map(f), f("vibe.manifest.json"), f("vibe.schema.json"), f("vibe.jobs.json")]);
  assert.deepEqual(out.map((x) => x.name), names);
});
