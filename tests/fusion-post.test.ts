import { describe, expect, it } from "vitest";
import { buildVirtualCutShopbotPost, VIRTUALCUT_POST_PATCH_VERSION } from "../lib/fusion-post";

const officialPostShape = `/**
  $Revision: 44229 abc123 $
*/
description = "ShopBot OpenSBP";

function onOpen() {
  var workpiece = getWorkpiece();
  stockHeight = workpiece.upper.z;
}

function onSection() {
  var insertToolCall = isToolChangeNeeded("number");
  writeToolCall(tool, insertToolCall);
  startSpindle(tool, insertToolCall);
}
`;

describe("VirtualCut Fusion post builder", () => {
  it("adds versioned stock metadata and structured metadata at each tool change", () => {
    const built = buildVirtualCutShopbotPost(officialPostShape.replace(/\n/g, "\r\n"));

    expect(built.upstreamRevision).toBe("44229 abc123");
    expect(built.source).toContain(`VirtualCut metadata patch ${VIRTUALCUT_POST_PATCH_VERSION}`);
    expect(built.source).toContain(`writeComment("VirtualCut: post-version=${VIRTUALCUT_POST_PATCH_VERSION}");`);
    expect(built.source).toContain('writeComment("VirtualCut: stock-coordinate-space=work");');
    expect(built.source).toContain('writeComment("VirtualCut: stock-min-x=" + xyzFormat.format(workpiece.lower.x));');
    expect(built.source).toContain('writeComment("VirtualCut: stock-width=" + xyzFormat.format(workpiece.upper.x - workpiece.lower.x));');
    expect(built.source).toContain('writeComment("VirtualCut: stock-thickness=" + xyzFormat.format(workpiece.upper.z - workpiece.lower.z));');
    expect(built.source).toContain("writeVirtualCutJobMetadata(workpiece);\n  stockHeight = workpiece.upper.z;");
    expect(built.source).toContain('writeComment("VirtualCut: tool-diameter=" + xyzFormat.format(tool.diameter));');
    expect(built.source).toContain("if (insertToolCall) {\n    writeVirtualCutToolMetadata(tool);");
    expect(built.source).toContain('description = "ShopBot OpenSBP - VirtualCut metadata";');
  });

  it("refuses to patch the same post twice", () => {
    const built = buildVirtualCutShopbotPost(officialPostShape);
    expect(() => buildVirtualCutShopbotPost(built.source)).toThrow(/already contains/i);
  });

  it("fails closed when the selected file is not the expected Autodesk post", () => {
    expect(() => buildVirtualCutShopbotPost("description = \"Something else\";"))
      .toThrow(/does not appear/i);
  });
});
