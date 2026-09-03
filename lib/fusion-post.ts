export const VIRTUALCUT_POST_PATCH_VERSION = "1.1.0";
export const AUTODESK_SHOPBOT_POST_URL = "https://cam.autodesk.com/posts/download.php?name=shopbot";
export const VIRTUALCUT_POST_FILENAME = "shopbot-virtualcut.cps";

const PATCH_MARKER = "VirtualCut metadata patch";
const SECTION_MARKER = "function onSection() {";
const TOOL_CALL_MARKER = "  writeToolCall(tool, insertToolCall);\n  startSpindle(tool, insertToolCall);";
const WORKPIECE_MARKER = "  var workpiece = getWorkpiece();\n  stockHeight = workpiece.upper.z;";

const METADATA_WRITER = `
// ${PATCH_MARKER} ${VIRTUALCUT_POST_PATCH_VERSION}
// Generated locally by virtualcut.eastbaymakersclub.com.
function writeVirtualCutJobMetadata(workpiece) {
  writeComment("VirtualCut: post-version=${VIRTUALCUT_POST_PATCH_VERSION}");
  writeComment("VirtualCut: stock-shape=box");
  writeComment("VirtualCut: stock-units=" + (unit == MM ? "mm" : "in"));
  writeComment("VirtualCut: stock-coordinate-space=work");
  writeComment("VirtualCut: stock-min-x=" + xyzFormat.format(workpiece.lower.x));
  writeComment("VirtualCut: stock-min-y=" + xyzFormat.format(workpiece.lower.y));
  writeComment("VirtualCut: stock-min-z=" + xyzFormat.format(workpiece.lower.z));
  writeComment("VirtualCut: stock-max-x=" + xyzFormat.format(workpiece.upper.x));
  writeComment("VirtualCut: stock-max-y=" + xyzFormat.format(workpiece.upper.y));
  writeComment("VirtualCut: stock-max-z=" + xyzFormat.format(workpiece.upper.z));
  writeComment("VirtualCut: stock-width=" + xyzFormat.format(workpiece.upper.x - workpiece.lower.x));
  writeComment("VirtualCut: stock-height=" + xyzFormat.format(workpiece.upper.y - workpiece.lower.y));
  writeComment("VirtualCut: stock-thickness=" + xyzFormat.format(workpiece.upper.z - workpiece.lower.z));
  writeComment("VirtualCut: stock-z-origin=" + (workpiece.lower.z >= 0 ? "table" : "top"));
}

function writeVirtualCutToolMetadata(tool) {
  writeComment("VirtualCut: tool-number=" + toolFormat.format(tool.number));
  writeComment("VirtualCut: tool-diameter=" + xyzFormat.format(tool.diameter));
  writeComment("VirtualCut: tool-units=" + (unit == MM ? "mm" : "in"));
  if (tool.numberOfFlutes > 0) {
    writeComment("VirtualCut: tool-flutes=" + tool.numberOfFlutes);
  }
  writeComment("VirtualCut: tool-type=" + getToolTypeName(tool.type));
  writeComment("VirtualCut: tool-flute-length=" + xyzFormat.format(tool.fluteLength));
  if (tool.description) {
    writeComment("VirtualCut: tool-description=" + tool.description);
  }
  if (tool.comment) {
    writeComment("VirtualCut: tool-comment=" + tool.comment);
  }
  if (tool.vendor) {
    writeComment("VirtualCut: tool-vendor=" + tool.vendor);
  }
  if (tool.productId) {
    writeComment("VirtualCut: tool-product-id=" + tool.productId);
  }
}
`;

export interface VirtualCutPostBuild {
  source: string;
  upstreamRevision: string | null;
}

export function buildVirtualCutShopbotPost(source: string): VirtualCutPostBuild {
  const normalizedSource = source.replace(/\r\n?/g, "\n");
  if (normalizedSource.includes(PATCH_MARKER)) {
    throw new Error("This post already contains the VirtualCut metadata patch.");
  }
  if (!/description\s*=\s*"ShopBot OpenSBP"\s*;/.test(normalizedSource)) {
    throw new Error("This does not appear to be Autodesk’s ShopBot OpenSBP post.");
  }
  if (
    !normalizedSource.includes(SECTION_MARKER)
    || !normalizedSource.includes(TOOL_CALL_MARKER)
    || !normalizedSource.includes(WORKPIECE_MARKER)
  ) {
    throw new Error("This Autodesk post revision has changed and cannot be patched safely yet.");
  }

  const upstreamRevision = normalizedSource.match(/\$Revision:\s*([^$]+?)\s*\$/)?.[1]?.trim() ?? null;
  const withWriter = normalizedSource.replace(SECTION_MARKER, `${METADATA_WRITER}\n${SECTION_MARKER}`);
  const withStockCall = withWriter.replace(
    WORKPIECE_MARKER,
    `  var workpiece = getWorkpiece();\n  writeVirtualCutJobMetadata(workpiece);\n  stockHeight = workpiece.upper.z;`,
  );
  const withCall = withStockCall.replace(
    TOOL_CALL_MARKER,
    `  writeToolCall(tool, insertToolCall);\n  if (insertToolCall) {\n    writeVirtualCutToolMetadata(tool);\n  }\n  startSpindle(tool, insertToolCall);`,
  );
  const patched = withCall.replace(
    'description = "ShopBot OpenSBP";',
    'description = "ShopBot OpenSBP - VirtualCut metadata";',
  );

  return { source: patched, upstreamRevision };
}
