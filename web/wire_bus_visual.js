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

function drawBusLane(ctx, start, end, color, width, offset) {
  const sx = start[0];
  const sy = start[1] + offset;
  const ex = end[0];
  const ey = end[1] + offset;
  const dx = Math.abs(ex - sx);
  const tangent = Math.max(40, Math.min(180, dx * 0.5));

  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.bezierCurveTo(sx + tangent, sy, ex - tangent, ey, ex, ey);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();
}

function drawBusCable(ctx, start, end, color, baseWidth) {
  const laneWidth = Math.max(2.5, baseWidth);
  const spacing = laneWidth * 1.05;
  ctx.save();
  ctx.globalAlpha = 0.78;
  for (const offset of [-spacing, 0, spacing]) {
    drawBusLane(ctx, start, end, color, laneWidth, offset);
  }
  ctx.restore();
}

function hideBusLinksForNativeDraw(graph) {
  const busLinks = allLinks(graph).filter((link) => isBusLink(graph, link));
  if (!busLinks.length) return () => {};

  const bags = [];
  const seenBags = new Set();
  for (const bag of [graph?.links, graph?._links]) {
    if (!bag || seenBags.has(bag)) continue;
    seenBags.add(bag);
    bags.push(bag);
  }

  const removed = [];
  for (const bag of bags) {
    const isMap = typeof bag.delete === "function" && typeof bag.set === "function";
    for (const link of busLinks) {
      const id = link?.id ?? link?.link_id ?? link?.linkId;
      if (id == null) continue;
      const keys = [id, String(id)];
      for (const key of keys) {
        const exists = isMap
          ? bag.has?.(key)
          : Object.prototype.hasOwnProperty.call(bag, key);
        if (!exists) continue;
        const value = isMap ? bag.get(key) : bag[key];
        removed.push({ bag, isMap, key, value });
        if (isMap) bag.delete(key);
        else delete bag[key];
        break;
      }
    }
  }

  return () => {
    for (const item of removed) {
      if (item.isMap) item.bag.set(item.key, item.value);
      else item.bag[item.key] = item.value;
    }
  };
}

function patchCanvas(canvas) {
  if (!canvas || canvas.__terryWireBusRibbonPatched || typeof canvas.drawConnections !== "function") return;
  canvas.__terryWireBusRibbonPatched = true;
  const original = canvas.drawConnections;

  canvas.drawConnections = function (ctx) {
    const graph = this.graph || app.graph;
    const busLinks = allLinks(graph).filter((link) => isBusLink(graph, link));
    const restore = hideBusLinksForNativeDraw(graph);
    let result;

    try {
      result = original.apply(this, arguments);
    } finally {
      restore();
    }

    try {
      const baseWidth = Math.max(3, Number(this.connections_width) || 3);
      for (const link of busLinks) {
        const { origin, target, originSlot, targetSlot } = linkNodes(graph, link);
        if (!origin || !target) continue;
        drawBusCable(
          ctx,
          pointForOutput(origin, originSlot),
          pointForInput(target, targetSlot),
          busColor(link),
          baseWidth
        );
      }
    } catch (error) {
      console.warn("[Terry Wire Bus] Failed to draw bus cable", error);
    }

    return result;
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
