import { app } from "../../scripts/app.js";

const NODE_ID = "TerryH3PromptEditor";
const PATCH_FLAG = "__terryH3PatchApplied";
const COLLECTOR_Y = 24;

function isAssetInput(input) {
  return String(input?.name || "").toLowerCase().includes("asset");
}

function getLink(graph, id) {
  if (id == null || !graph) return null;
  for (const links of [graph.links, graph._links]) {
    if (!links) continue;
    if (typeof links.get === "function") {
      const found = links.get(id) ?? links.get(String(id));
      if (found) return found;
    }
    const found = links[id] ?? links[String(id)];
    if (found) return found;
  }
  return null;
}

function refreshCollectorAppearance(node) {
  const assetInputs = (node.inputs || []).filter(isAssetInput);
  if (!assetInputs.length) return;

  for (const input of assetInputs) {
    // LiteGraph inputs normally allow one link each. Keep the Autogrow inputs for
    // execution, but render every reference socket at the same point so the node
    // behaves visually like a single multi-reference collector.
    input.pos = [0, COLLECTOR_Y];
    input.label = "";
  }

  node.setDirtyCanvas?.(true, true);
}

function ensureEmptySlotReceivesConnection(node, targetSlot) {
  const inputs = node.inputs || [];
  const target = inputs[targetSlot];
  if (!isAssetInput(target) || target?.link == null) return;

  const emptySlot = inputs.findIndex((input, index) =>
    index !== targetSlot && isAssetInput(input) && input?.link == null
  );
  if (emptySlot < 0) return;

  // The visible collector sockets overlap. If LiteGraph resolves the drop to an
  // already-connected internal slot, swap that slot with Autogrow's spare empty
  // slot before LiteGraph creates the new link. Existing links keep their input
  // object, and target_slot is updated to follow it.
  const occupied = inputs[targetSlot];
  const empty = inputs[emptySlot];
  inputs[targetSlot] = empty;
  inputs[emptySlot] = occupied;

  const previous = getLink(node.graph || app.graph, occupied.link);
  if (previous) {
    previous.target_slot = emptySlot;
    if ("targetSlot" in previous) previous.targetSlot = emptySlot;
  }
}

function patchCollector(node) {
  if (node.__terryH3CollectorPatched) return;
  node.__terryH3CollectorPatched = true;

  const oldConnectInput = node.onConnectInput;
  node.onConnectInput = function(slot) {
    ensureEmptySlotReceivesConnection(this, Number(slot));
    return oldConnectInput?.apply(this, arguments);
  };

  const oldDrawForeground = node.onDrawForeground;
  node.onDrawForeground = function(ctx) {
    oldDrawForeground?.apply(this, arguments);
    const count = (this.inputs || []).filter((x) => isAssetInput(x) && x.link != null).length;
    ctx.save();
    ctx.font = "11px Inter, Arial, sans-serif";
    ctx.fillStyle = "rgba(220,220,220,.78)";
    ctx.textBaseline = "middle";
    ctx.fillText(count ? `参考 · ${count} 路` : "参考 · 多路输入", 12, COLLECTOR_Y);
    ctx.restore();
  };

  refreshCollectorAppearance(node);
}

function normalizeAtCaret(visual, event) {
  if (event.inputType !== "insertText" || event.data !== "@") return false;
  const sel = window.getSelection();
  if (!sel?.rangeCount || !visual.contains(sel.anchorNode)) return false;
  if (sel.anchorNode?.nodeType === Node.TEXT_NODE) return false;

  event.preventDefault();
  const range = sel.getRangeAt(0).cloneRange();
  range.deleteContents();
  const text = document.createTextNode("@");
  range.insertNode(text);

  const caret = document.createRange();
  caret.setStart(text, 1);
  caret.collapse(true);
  sel.removeAllRanges();
  sel.addRange(caret);
  return true;
}

function patchEditorUi(node) {
  const root = node.__terryH3?.root;
  if (!root || root[PATCH_FLAG]) return;
  root[PATCH_FLAG] = true;

  const toolbar = root.firstElementChild;
  const buttons = toolbar?.querySelectorAll?.("button") || [];
  const visualBtn = buttons[0];
  const sourceBtn = buttons[1];

  if (toolbar) {
    toolbar.style.display = "flex";
    toolbar.style.position = "sticky";
    toolbar.style.top = "0";
    toolbar.style.zIndex = "30";
    toolbar.style.padding = "5px 6px";
    toolbar.style.margin = "-4px -4px 7px";
    toolbar.style.background = "var(--comfy-menu-bg,#202225)";
    toolbar.style.borderBottom = "1px solid rgba(255,255,255,.12)";
  }

  if (visualBtn && sourceBtn) {
    visualBtn.textContent = "预览";
    sourceBtn.textContent = "纯文本";
    for (const button of [visualBtn, sourceBtn]) {
      button.style.display = "inline-flex";
      button.style.alignItems = "center";
      button.style.justifyContent = "center";
      button.style.height = "31px";
      button.style.minWidth = "74px";
      button.style.padding = "0 12px";
      button.style.fontSize = "12px";
      button.style.fontWeight = "600";
      button.style.opacity = "1";
    }
  }

  const visual = [...root.querySelectorAll('[contenteditable="true"]')]
    .find((el) => el.parentElement === root || el.style?.minHeight);
  if (!visual) return;

  visual.addEventListener("beforeinput", (event) => {
    if (!normalizeAtCaret(visual, event)) return;
    queueMicrotask(() => {
      visual.dispatchEvent(new KeyboardEvent("keyup", { key: "@", bubbles: true }));
    });
  }, true);

  // The original editor only refreshes the @ menu on keyup. input also covers
  // IME/composition, paste-normalized caret positions and browser variations.
  visual.addEventListener("input", () => {
    queueMicrotask(() => {
      visual.dispatchEvent(new KeyboardEvent("keyup", { key: "", bubbles: true }));
    });
  });
}

function patchNode(node) {
  if (!node || (node.comfyClass !== NODE_ID && node.constructor?.type !== NODE_ID)) return;
  patchCollector(node);
  patchEditorUi(node);
  queueMicrotask(() => {
    refreshCollectorAppearance(node);
    patchEditorUi(node);
  });
}

app.registerExtension({
  name: "TerryToolbox.H3PromptEditor.Patch",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_ID) return;

    const oldCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function() {
      const result = oldCreated?.apply(this, arguments);
      queueMicrotask(() => patchNode(this));
      return result;
    };

    const oldConnections = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function() {
      const result = oldConnections?.apply(this, arguments);
      queueMicrotask(() => {
        refreshCollectorAppearance(this);
        patchEditorUi(this);
      });
      return result;
    };

    const oldConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function() {
      const result = oldConfigure?.apply(this, arguments);
      queueMicrotask(() => patchNode(this));
      return result;
    };
  },

  loadedGraphNode(node) {
    queueMicrotask(() => patchNode(node));
  }
});
