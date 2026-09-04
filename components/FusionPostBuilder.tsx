"use client";

import { useState } from "react";
import {
  buildVirtualCutShopbotPost,
  VIRTUALCUT_POST_FILENAME,
  VIRTUALCUT_POST_PATCH_VERSION,
} from "../lib/fusion-post";

const MAX_POST_BYTES = 2 * 1024 * 1024;
const AUTODESK_POST_SOURCE_URL = "/api/fusion-post";
const EBMC_TOOL_LIBRARY_URL = "/ebmc-tools-2026-09-03.tools";
const EBMC_TOOL_LIBRARY_FILENAME = "EBMC Tools - 2026-09-03.tools";
const EBMC_MACHINE_DEFINITION_URL = "/ebmc-shopbot-prsalpha-96-48-2.3-hp-hsd.mch";
const EBMC_MACHINE_DEFINITION_FILENAME = "ShopBot Tools PRSalpha 96-48, 2.3 HP HSD (Manual Tool Change).mch";

export function FusionPostBuilder() {
  const [message, setMessage] = useState("Downloads Autodesk’s current ShopBot post and applies the VirtualCut patch in your browser.");
  const [messageType, setMessageType] = useState<"ready" | "loading" | "success" | "error">("ready");
  const [isBuilding, setIsBuilding] = useState(false);

  const buildPost = async () => {
    setIsBuilding(true);
    setMessageType("loading");
    setMessage("Getting Autodesk’s current ShopBot post…");
    try {
      const response = await fetch(AUTODESK_POST_SOURCE_URL, { cache: "no-store" });
      if (!response.ok) {
        throw new Error("Autodesk’s ShopBot post could not be reached. Please try again in a moment.");
      }
      const source = await response.text();
      if (new Blob([source]).size > MAX_POST_BYTES) {
        throw new Error("Autodesk’s ShopBot post was unexpectedly large and was not processed.");
      }

      const built = buildVirtualCutShopbotPost(source);
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
    } finally {
      setIsBuilding(false);
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
        <button className="post-build-button" type="button" onClick={() => void buildPost()} disabled={isBuilding}>
          {isBuilding ? "Preparing VirtualCut post…" : "Download VirtualCut post"}
        </button>
        <p className={`post-build-message ${messageType}`} role="status">{message}</p>
        <p className="post-install-note"><strong>Install:</strong> In Fusion’s Post Library, choose Local, then Import and select {VIRTUALCUT_POST_FILENAME}.</p>
        <small>Patch {VIRTUALCUT_POST_PATCH_VERSION}. Autodesk’s current source is fetched on demand and never stored; VirtualCut applies the patch and creates the download in your browser.</small>
      </div>
    </section>
  );
}
