import test from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("manifest describes an installable standalone app and all icons exist", async () => {
  const manifest = JSON.parse(await readFile(path.join(root, "manifest.webmanifest"), "utf8"));
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "./");
  assert.ok(manifest.name);
  assert.ok(manifest.icons.some((icon) => icon.sizes === "192x192"));
  assert.ok(manifest.icons.some((icon) => icon.sizes === "512x512"));
  await Promise.all(manifest.icons.map((icon) => access(path.join(root, icon.src))));
});

test("service worker offline shell references existing files", async () => {
  const worker = await readFile(path.join(root, "sw.js"), "utf8");
  const shellMatch = worker.match(/const APP_SHELL = \[([\s\S]*?)\];/);
  assert.ok(shellMatch, "APP_SHELL should be declared");
  const files = [...shellMatch[1].matchAll(/"\.\/(.*?)"/g)].map((match) => match[1] || "index.html");
  await Promise.all(files.map((file) => access(path.join(root, file))));
});

test("HTML links the manifest, service worker app, and viewport metadata", async () => {
  const html = await readFile(path.join(root, "index.html"), "utf8");
  assert.match(html, /rel="manifest" href="manifest\.webmanifest"/);
  assert.match(html, /name="viewport"/);
  assert.match(html, /type="module" src="app\.js"/);
});
