import { app } from "../../scripts/app.js";

const NODE_ID = "EnhancedFileSave";

function isTarget(node) {
  return [
    node?.comfyClass,
    node?.type,
    node?.constructor?.type,
    node?.constructor?.comfyClass,
    node?.constructor?.nodeData?.name,
  ].some((value) => String(value || "") === NODE_ID);
}

function prepareSeparator(node) {
  if (!isTarget(node)) return;
  const separator = node.__terryMediaSeparator;
  const element = separator?.element;
  if (!element) return;

  // Nodes 2.0 lays DOM widgets out from the value-column origin, so the
  // separator's own border starts too far to the right. Keep the DOM widget
  // only as a layout spacer and draw the line in node coordinates instead.
  element.style.borderTop = "none";
  element.style.margin = "0";
}

function separatorY(node) {
  const widget = node.__terryMediaSeparator?.widget;
  if (!widget || widget.hidden) return null;

  const values = [widget.last_y, widget.y, widget.pos?.[1]];
  for (const value of values) {
    const y = Number(value);
    if (Number.isFinite(y) && y >= 0) return y + 1;
  }
  return null;
}

function drawSeparator(node, ctx) {
  prepareSeparator(node);

  const y = separatorY(node);
  if (y == null || !ctx) return;

  const width = Number(node.size?.[0]) || 0;
  if (width <= 70) return;

  ctx.save();
  ctx.beginPath();
  // Match the section-title inset used by Nodes 2.0 instead of the narrower
  // DOM-widget value column.
  ctx.moveTo(50, y + 0.5);
  ctx.lineTo(width - 12, y + 0.5);
  ctx.strokeStyle = "rgba(180, 180, 180, 0.28)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

function schedule(node) {
  if (!isTarget(node)) return;
  queueMicrotask(() => prepareSeparator(node));
  requestAnimationFrame(() => prepareSeparator(node));
  setTimeout(() => prepareSeparator(node), 80);
  setTimeout(() => prepareSeparator(node), 240);
}

app.registerExtension({
  name: "TerryToolbox.EnhancedFileSave.Nodes2SeparatorFix",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_ID || nodeType.prototype.__terryNodes2SeparatorFix) return;
    nodeType.prototype.__terryNodes2SeparatorFix = true;

    const originalDrawForeground = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function(ctx) {
      const result = originalDrawForeground?.apply(this, arguments);
      drawSeparator(this, ctx);
      return result;
    };

    for (const hook of ["onNodeCreated", "onAdded", "onConfigure", "onConnectionsChange"]) {
      const original = nodeType.prototype[hook];
      nodeType.prototype[hook] = function() {
        const result = original?.apply(this, arguments);
        schedule(this);
        return result;
      };
    }
  },

  nodeCreated(node) {
    schedule(node);
  },

  loadedGraphNode(node) {
    schedule(node);
  },
});
