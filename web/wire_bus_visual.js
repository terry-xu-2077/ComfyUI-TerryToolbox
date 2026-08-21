import { app } from "../../scripts/app.js";

const BUS_TYPE = "TERRY_WIRE_BUS";
const PACK_TYPE = "TerryWireBusPack";

function nodeType(node) {
  return String(
    node?.comfyClass ||
      node?.type ||
      node?.constructor?.comfyClass ||
      node?.constructor?.type ||
      ""
  );
}

function getLink(graph, id) {
  if (!graph || id == null) return null;
  for (const bag of [graph.links, graph._links]) {
    if (!bag) continue;
    if (typeof bag.get === "function") {
      const hit = bag.get(id) ?? bag.get(String(id));
      if (hit) return hit;
    }
    const hit = bag[id] ?? bag[String(id)];
    if (hit) return hit;
  }
  return null;
}

function allLinks(graph) {
  const out = [];
  const seen = new Set();
  for (const bag of [graph?.links, graph?._links]) {
    if (!bag) continue;
    const values = typeof bag.values === "function" ? bag.values() : Object.values(bag);
    for (const link of values) {
      if (!link) continue;
      const id = link.id ?? link.link_id ?? link.linkId;
      const key = id == null ? link : String(id);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(link);
    }
  }
  return out;
}

function linkNodes(graph, link) {
  const originId = link?.origin_id ?? link?.originId;
  const targetId = link?.target_id ?? link?.targetId;
  return {
    origin: graph?.getNodeById?.(originId) || null,
    target: graph?.getNodeById?.(targetId) || null,
    originSlot: Number(link?.origin_slot ?? link?.originSlot ?? 0) || 0,
    targetSlot: Number(link?.target_slot ?? link?.targetSlot ?? 0) || 0,
  };
}

function isBusLink(graph, link) {
  const { origin, target, originSlot, targetSlot } = linkNodes(graph, link);
  const type = String(
    link?.type ||
      origin?.outputs?.[originSlot]?.type ||
      target?.inputs?.[targetSlot]?.type ||
      ""
  );
  return type === BUS_TYPE || nodeType(origin) === PACK_TYPE;
}

function pointForOutput(node, slot) {
  const p = node?.getOutputPos?.(slot);
  if (Array.isArray(p) && p.length >= 2) return p;
  return [Number(node?.pos?.[0] || 0) + Number(node?.size?.[0] || 0), Number(node?.pos?.[1] || 0) + 40];
}

function pointForInput(node, slot) {
  const p = node?.getInputPos?.(slot);
  if (Array.isArray(p) && p.length >= 2) return p;
  return [Number(node?.pos?.[0] || 0), Number(node?.pos?.[1] || 0) + 40 + slot * 20];
}

function busColor(link) {
  return (
    link?.color ||
    globalThis.LGraphCanvas?.link_type_colors?.[BUS_TYPE] ||
    globalThis.LGraphCanvas?.link_type_colors?.["*"] ||
    "#9ca3af"
  );
}

function drawRibbon(ctx, start, end, color, width) {
  const dx = Math.abs(end[0] - start[0]);
  const tangent = Math.max(40, Math.min(180, dx * 0.5));
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(start[0], start[1]);
  ctx.bezierCurveTo(start[0] + tangent, start[1], end[0] - tangent, end[1], end[0], end[1]);
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.62;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.restore();
}

function patchCanvas(canvas) {
  if (!canvas || canvas.__terryWireBusRibbonPatched || typeof canvas.drawConnections !== "function") return;
  canvas.__terryWireBusRibbonPatched = true;
  const original = canvas.drawConnections;

  canvas.drawConnections = function (ctx) {
    try {
      const graph = this.graph || app.graph;
      const baseWidth = Math.max(3, Number(this.connections_width) || 3);
      const ribbonWidth = Math.max(7, baseWidth * 2.15);
      for (const link of allLinks(graph)) {
        if (!isBusLink(graph, link)) continue;
        const { origin, target, originSlot, targetSlot } = linkNodes(graph, link);
        if (!origin || !target) continue;
        drawRibbon(
          ctx,
          pointForOutput(origin, originSlot),
          pointForInput(target, targetSlot),
          busColor(link),
          ribbonWidth
        );
      }
    } catch (error) {
      console.warn("[Terry Wire Bus] Failed to draw bus ribbon", error);
    }
    return original.apply(this, arguments);
  };
}

let timer = null;
function ensurePatched() {
  patchCanvas(app.canvas);
  if (timer) return;
  timer = setInterval(() => patchCanvas(app.canvas), 1000);
}

app.registerExtension({
  name: "TerryToolbox.WireBusVisual",
  setup() { ensurePatched(); },
  loadedGraphNode() { ensurePatched(); },
});
