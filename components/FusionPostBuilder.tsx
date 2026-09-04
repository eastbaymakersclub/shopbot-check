"use client";

import { useState, type ChangeEvent } from "react";
import {
  AUTODESK_SHOPBOT_POST_URL,
  buildVirtualCutShopbotPost,
  VIRTUALCUT_POST_FILENAME,
  VIRTUALCUT_POST_PATCH_VERSION,
} from "../lib/fusion-post";

const MAX_POST_BYTES = 2 * 1024 * 1024;
const EBMC_TOOL_LIBRARY_URL = "/ebmc-tools-2026-09-03.tools";
const EBMC_TOOL_LIBRARY_FILENAME = "EBMC Tools - 2026-09-03.tools";
const EBMC_MACHINE_DEFINITION_URL = "/ebmc-shopbot-prsalpha-96-48-2.3-hp-hsd.mch";
const EBMC_MACHINE_DEFINITION_FILENAME = "ShopBot Tools PRSalpha 96-48, 2.3 HP HSD (Manual Tool Change).mch";

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
        <h2>Set up Fusion for EBMC and VirtualCut</h2>
        <p>Start with EBMC’s shared cutter library and PRSalpha machine definition, then use the EBMC post patch to put exact tool data, modeled stock bounds, and the post version in every ShopBot file. VirtualCut reads the added comments automatically; ShopBot ignores them.</p>
        <div className="fusion-post-fields" aria-label="Embedded Fusion fields">
          <span>Diameter</span><span>Flutes</span><span>Geometry</span><span>Vendor / ID</span><span>Stock size / offset</span><span>Post version</span>
        </div>
      </div>
      <div className="fusion-post-actions">
        <div className="fusion-tool-library">
          <p className="fusion-resource-label">EBMC tool library</p>
          <strong>ShopBot cutters and starting parameters</strong>
          <a href={EBMC_TOOL_LIBRARY_URL} download={EBMC_TOOL_LIBRARY_FILENAME}>
            Download EBMC tool library
          </a>
          <p className="post-install-note"><strong>Install:</strong> In Fusion’s Tool Library, select Local, choose Import Tool Library, and open the downloaded <code>.tools</code> file.</p>
          <small>Updated September 3, 2026 · 24 EBMC tools</small>
        </div>
        <div className="fusion-post-divider" aria-hidden="true" />
        <div className="fusion-tool-library">
          <p className="fusion-resource-label">EBMC machine definition</p>
          <strong>ShopBot PRSalpha 96-48 · 2.3 HP HSD</strong>
          <a href={EBMC_MACHINE_DEFINITION_URL} download={EBMC_MACHINE_DEFINITION_FILENAME}>
            Download EBMC machine definition
          </a>
          <p className="post-install-note"><strong>Install:</strong> In Fusion’s Machine Library, select Local, choose Import, and open the downloaded <code>.mch</code> file.</p>
          <small>Manual tool change · 9,000–18,000 RPM spindle · 4 × 8 ft table</small>
        </div>
        <div className="fusion-post-divider" aria-hidden="true" />
        <p className="fusion-resource-label">VirtualCut post</p>
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
