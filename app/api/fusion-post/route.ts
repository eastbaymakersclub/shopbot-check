import { AUTODESK_SHOPBOT_POST_URL } from "../../../lib/fusion-post";

const MAX_POST_BYTES = 2 * 1024 * 1024;
const EXPECTED_DESCRIPTION = 'description = "ShopBot OpenSBP";';

function unavailable(message: string) {
  return new Response(message, {
    status: 502,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET() {
  try {
    const upstream = await fetch(AUTODESK_SHOPBOT_POST_URL, {
      cache: "no-store",
      redirect: "follow",
      headers: { Accept: "application/octet-stream, text/plain;q=0.9" },
    });
    if (!upstream.ok) {
      return unavailable("Autodesk’s ShopBot post is temporarily unavailable.");
    }

    const declaredLength = Number(upstream.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_POST_BYTES) {
      return unavailable("Autodesk’s ShopBot post was unexpectedly large.");
    }

    const source = await upstream.text();
    if (new TextEncoder().encode(source).byteLength > MAX_POST_BYTES) {
      return unavailable("Autodesk’s ShopBot post was unexpectedly large.");
    }
    if (!source.includes(EXPECTED_DESCRIPTION)) {
      return unavailable("Autodesk’s response was not the expected ShopBot post.");
    }

    return new Response(source, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return unavailable("Autodesk’s ShopBot post is temporarily unavailable.");
  }
}
