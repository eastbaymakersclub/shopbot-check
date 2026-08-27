"use client";

import { useState, type ChangeEvent } from "react";
import {
  AUTODESK_SHOPBOT_POST_URL,
  buildVirtualCutShopbotPost,
  VIRTUALCUT_POST_FILENAME,
  VIRTUALCUT_POST_PATCH_VERSION,
} from "../lib/fusion-post";

const MAX_POST_BYTES = 2 * 1024 * 1024;

export function FusionPostBuilder() {
  const [message, setMessage] = useState("Choose Autodesk’s downloaded shopbot.cps to build the VirtualCut edition.");
  const [messageType, setMessageType] = useState<"ready" | "success" | "error">("ready");

  const buildPost = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".cps")) {
      setMessageType("error");
      setMessage("Choose Autodesk’s ShopBot post file ending in .cps.");
      return;
    }
    if (file.size > MAX_POST_BYTES) {
      setMessageType("error");
      setMessage("That post is unexpectedly large and was not processed.");
      return;
    }

    try {
      const built = buildVirtualCutShopbotPost(await file.text());
      const objectUrl = URL.createObjectURL(new Blob([built.source], { type: "text/plain;charset=utf-8" }));
      const download = document.createElement("a");
      download.href = objectUrl;
      download.download = VIRTUALCUT_POST_FILENAME;
      download.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      setMessageType("success");
      setMessage(`Built ${VIRTUALCUT_POST_FILENAME}${built.upstreamRevision ? ` from Autodesk revision ${built.upstreamRevision}` : ""}.`);
    } catch (caught) {
      setMessageType("error");
      setMessage(caught instanceof Error ? caught.message : "The post could not be patched safely.");
    }
  };

  return (
    <section className="fusion-post-panel" id="fusion-post">
      <div className="fusion-post-copy">
        <p className="eyebrow">Fusion integration</p>
        <h2>Put exact cutter data in every ShopBot file</h2>
        <p>The EBMC patch adds diameter, flute count, tool type, flute length, description, vendor, and product ID as inert comments. VirtualCut reads them automatically; ShopBot ignores them.</p>
        <div className="fusion-post-fields" aria-label="Embedded Fusion fields">
          <span>Diameter</span><span>Flutes</span><span>Geometry</span><span>Vendor / ID</span>
        </div>
      </div>
      <div className="fusion-post-actions">
        <ol>
          <li><a href={AUTODESK_SHOPBOT_POST_URL}>Download Autodesk’s ShopBot post ↗</a></li>
          <li>
            <label className="post-build-button">
              Build the EBMC edition
              <input type="file" accept=".cps" onChange={buildPost} />
            </label>
          </li>
        </ol>
        <p className={`post-build-message ${messageType}`} role="status">{message}</p>
        <p className="post-install-note"><strong>Install:</strong> In Fusion’s Post Library, choose Local, then Import and select {VIRTUALCUT_POST_FILENAME}.</p>
        <small>Patch {VIRTUALCUT_POST_PATCH_VERSION} runs entirely in your browser. Autodesk’s source is never uploaded or redistributed by VirtualCut.</small>
      </div>
    </section>
  );
}
