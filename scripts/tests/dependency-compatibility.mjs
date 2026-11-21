// Run from the workspace root: node --test scripts/tests/dependency-compatibility.mjs
// Resolve through the real consumers so overrides are tested, not unrelated copies.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { test } from "node:test";

const consumer = (path) => createRequire(resolve(path, "package.json"));
const api = consumer("artifacts/api-server");
const mobile = consumer("artifacts/index-mobile");

test("Zod 4 validates API inputs and bounds collection errors", async () => {
  const { build } = api("esbuild");
  const { outputFiles } = await build({
    stdin: {
      resolveDir: resolve("lib/api-zod"),
      contents: `export { CreateItemBody, UpdateItemBody, UpdateSettingsBody } from "./src/generated/api";`,
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
  });
  const schemas = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
  assert.equal(schemas.CreateItemBody.parse({ title: "Keep paragraphs\n\nSecond paragraph" }).title, "Keep paragraphs\n\nSecond paragraph");
  assert.equal(schemas.CreateItemBody.safeParse({ title: 123 }).success, false);
  assert.equal(schemas.UpdateItemBody.safeParse({ status: "completed" }).success, true);
  assert.equal(schemas.UpdateItemBody.safeParse({ status: "invalid" }).success, false);
  assert.equal(schemas.UpdateSettingsBody.safeParse({ timezone: "UTC" }).success, true);
  const { z } = api("zod");
  const oversized = z.array(z.string()).max(2).safeParse(Array(10000).fill(1));
  assert.equal(oversized.success, false);
  assert.ok(oversized.error.issues.length < 100, "oversized constrained arrays must fail without per-element issue amplification");
});

for (const path of ["artifacts/ring-inbox", "artifacts/mockup-sandbox"]) {
  test(`${path} form resolver accepts Zod 4 success and error results`, async () => {
    const require = consumer(path);
    const { z } = require("zod");
    const { zodResolver } = require("@hookform/resolvers/zod");
    const resolver = zodResolver(z.object({ title: z.string().min(1) }));
    const options = { fields: {}, shouldUseNativeValidation: false };
    assert.deepEqual(await resolver({ title: "Task" }, {}, options), { errors: {}, values: { title: "Task" } });
    const invalid = await resolver({ title: "" }, {}, options);
    assert.equal(invalid.errors.title.type, "too_small");
  });
}

test("mobile validation errors retain readable Zod 4 messages", () => {
  const { z } = mobile("zod");
  const { fromZodError } = mobile("zod-validation-error");
  const result = z.object({ title: z.string() }).safeParse({ title: 42 });
  assert.equal(result.success, false);
  assert.match(fromZodError(result.error).message, /title/);
});

test("Storage 7 consumers retain CommonJS UUID generation with bounds checks", () => {
  const storage = createRequire(api.resolve("@google-cloud/storage"));
  const consumers = [createRequire(storage.resolve("gaxios")), createRequire(storage.resolve("teeny-request"))];
  for (const require of consumers) {
    const uuid = require("uuid");
    assert.equal(uuid.validate(uuid.v4()), true);
    assert.throws(() => uuid.v5("test", uuid.v5.DNS, new Uint8Array(8), 4), RangeError);
  }
  const { Storage } = api("@google-cloud/storage");
  const client = new Storage({ projectId: "dependency-test" });
  assert.equal(typeof client.bucket("dependency-test").file("recording.wav").createWriteStream, "function");
});

test("Expo fingerprint's minimatch override preserves glob behavior", () => {
  const expo = createRequire(mobile.resolve("expo"));
  const fingerprint = createRequire(expo.resolve("@expo/fingerprint"));
  const { minimatch, Minimatch } = fingerprint("minimatch");
  assert.equal(minimatch("app/tasks/index.tsx", "**/*.tsx"), true);
  assert.equal(minimatch("app/tasks/index.tsx", "**/*.json"), false);
  assert.equal(new Minimatch("**/*.tsx", { optimizationLevel: 2 }).match("app/tasks/index.tsx"), true);
});

test("Tailwind typography's selector parser preserves selectors", () => {
  const web = consumer("artifacts/ring-inbox");
  const typography = createRequire(web.resolve("@tailwindcss/typography"));
  const parser = typography("postcss-selector-parser");
  const selector = ".prose :where(p):not(:where(.not-prose *))";
  assert.equal(parser().processSync(selector), selector);
});
