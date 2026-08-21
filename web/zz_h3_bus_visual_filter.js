import { app } from "../../scripts/app.js";

const VISUAL_STATE_PROP = "terry_h3_wire_bus_visual_state";
const BUS_TYPE = "TERRY_WIRE_BUS";
const TARGETS = {
  TerryH3PromptEditor: "terry_h3_virtual_media_links",
  TerryH3ShotTimeline: "terry_h3_timeline_virtual_media_links",
};

function nodeType(node) {
  return String(
    node?.comfyClass ||
    node?.type ||
    node?.constructor?.comfyClass ||
    node?.constructor?.type ||
    node?.constructor?.nodeData?.name ||
    ""
  );
}

function cloneLink(link) {
  return {
    source_id: Number(link?.source_id),
    source_slot: Number(link?.source_slot) || 0,
    source_type: String(link?.source_type || "*"),
    kind: link?.kind,
  };
}

function connectionPos(node, input, slotIndex) {
  const modern = input ? node?.getInputPos?.(slotIndex) : node?.getOutputPos?.(slotIndex);
  if (Array.isArray(modern) && Number.isFinite(modern[0])) return modern;
  return input
    ? [Number(node?.pos?.[0] || 0), Number(node?.pos?.[1] || 0) + 40 + slotIndex * 20]
    : [Number(node?.pos?.[0] || 0) + Number(node?.size?.[0] || 200), Number(node?.pos?.[1] || 0) + 40 + slotIndex * 20];
}

function mediaInputIndex(node) {
  return node?.inputs?.findIndex?.((slot) => String(slot?.name || "") === "media") ?? -1;
}

function drawBus(canvas, ctx, graph, target, buses) {
  if (!ctx || !buses?.length) return;
  const inputIndex = mediaInputIndex(target);
  if (inputIndex < 0) return;
  const end = connectionPos(target, true, inputIndex);
  const colors = globalThis.LGraphCanvas?.link_type_colors || {};
  const color = colors[BUS_TYPE] || colors[BUS_TYPE.toLowerCase()] || globalThis.LiteGraph?.LINK_COLOR || "#9A9";

  for (const bus of buses) {
    const source = graph?.getNodeById?.(Number(bus?.source_id)) || app.graph?.getNodeById?.(Number(bus?.source_id));
    if (!source) continue;
    const start = connectionPos(source, false, Number(bus?.source_slot) || 0);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(start[0], start[1]);
    ctx.bezierCurveTo(start[0] + 80, start[1], end[0] - 80, end[1], end[0], end[1]);
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(6, (canvas?.connections_width || 3) * 2);
    ctx.globalAlpha *= 0.78;
    ctx.stroke();
    ctx.restore();
  }
}

function patchCanvas() {
  const canvas = app.canvas;
  if (!canvas || canvas.__terryH3BusFinalVisualFilter || typeof canvas.drawConnections !== "function") return;
  canvas.__terryH3BusFinalVisualFilter = true;
  const original = canvas.drawConnections;

  canvas.drawConnections = function (ctx) {
    const graph = this.graph || app.graph;
    const hidden = [];

    for (const node of graph?._nodes || []) {
      const prop = TARGETS[nodeType(node)];
      if (!prop) continue;
      const state = node?.properties?.[VISUAL_STATE_PROP];
      if (!state || !Array.isArray(state.buses) || !state.buses.length) continue;

      hidden.push({
        node,
        prop,
        media: node.properties?.[prop],
        buses: state.buses,
      });

      // During the whole existing draw chain, expose only genuinely direct media
      // references. This prevents H3's own virtual-link renderer from drawing the
      // media items that were internally expanded from a BUS. Temporarily hiding
      // buses also disables the older BUS overlay wrapper so only one BUS is drawn.
      node.properties[prop] = Array.isArray(state.direct) ? state.direct.map(cloneLink) : [];
      state.buses = [];
    }

    let result;
    try {
      result = original.apply(this, arguments);
    } finally {
      for (const item of hidden) {
        item.node.properties[item.prop] = item.media;
        item.node.properties[VISUAL_STATE_PROP].buses = item.buses;
      }
    }

    const drawCtx = ctx || this.bgctx || this.ctx;
    for (const item of hidden) drawBus(this, drawCtx, graph, item.node, item.buses);
    return result;
  };
}

let timer = null;
function start() {
  patchCanvas();
  if (timer) return;
  // Re-patch if another extension replaces drawConnections after setup.
  timer = setInterval(() => {
    if (!app.canvas) return;
    if (!app.canvas.__terryH3BusFinalVisualFilter) patchCanvas();
  }, 500);
}

app.registerExtension({
  name: "TerryToolbox.H3BusFinalVisualFilter",
  setup() {
    // zz_ filename intentionally loads after the H3 render extensions.
    start();
    queueMicrotask(patchCanvas);
  },
  afterConfigureGraph() {
    start();
    queueMicrotask(patchCanvas);
  },
});
