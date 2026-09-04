import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the ShopBot Check shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /ShopBot Check/);
  assert.match(html, /Job setup/);
  assert.match(html, /Analysis/);
  assert.match(html, /Machine-safe zero/);
  assert.match(html, /Stock-safe zero/);
  assert.match(html, /Machine X at work zero \(in\)/);
  assert.match(html, /Stock size &amp; position/);
  assert.match(html, /Stock lower-left X \(in\)/);
  assert.match(html, /Download VirtualCut post/);
  assert.doesNotMatch(html, /Download Autodesk’s ShopBot post/);
  assert.doesNotMatch(html, /accept="\.cps"/);
  assert.match(html, /Download EBMC tool library/);
  assert.match(html, /href="\/ebmc-tools-2026-09-03\.tools"/);
  assert.match(html, /Download EBMC machine definition/);
  assert.match(html, /href="\/ebmc-shopbot-prsalpha-96-48-2\.3-hp-hsd\.mch"/);
  assert.doesNotMatch(html, /synthetic demo/i);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});
