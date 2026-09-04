import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../app/api/fusion-post/route";

const officialPost = `/** $Revision: 44229 abc123 $ */
description = "ShopBot OpenSBP";
function onSection() {}
`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Autodesk ShopBot post relay", () => {
  it("returns the current source without storing or altering it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(officialPost, { status: 200 })));

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe(officialPost);
  });

  it("fails closed when Autodesk does not return the expected post", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>Not a post</html>", { status: 200 })));

    const response = await GET();

    expect(response.status).toBe(502);
    expect(await response.text()).toMatch(/not the expected ShopBot post/i);
  });

  it("reports an unavailable Autodesk endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Unavailable", { status: 503 })));

    const response = await GET();

    expect(response.status).toBe(502);
    expect(await response.text()).toMatch(/temporarily unavailable/i);
  });
});
