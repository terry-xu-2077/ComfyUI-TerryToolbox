import { app } from "../../scripts/app.js";

const PACK_TYPE = "TerryWireBusPack";
const BUS_TYPE = "TERRY_WIRE_BUS";
const MEDIA_TYPES = new Set(["IMAGE", "VIDEO", "AUDIO"]);
const MAX_MEDIA = 32;
const VISUAL_STATE_PROP = "terry_h3_wire_bus_visual_state";

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

function isPack(node) { return nodeType(node) === PACK_TYPE; }
function isReroute(node) {
  const type = nodeType(node).toLowerCase();
  return type === "reroute" || type.endsWith("reroute");
}
function isGet(node) { return nodeType(node) === "GetNode"; }
function isSet(node) { return nodeType(node) === "SetNode"; }

function getLink(graph, linkId) {
  if (!graph || linkId == null) return null;
  for (const links of [graph.links, graph._links]) {
    if (!links) continue;
    if (typeof links.get === "function") {
      const found = links.get(linkId) ?? links.get(String(linkId));
      if (found) return found;
    }
    const found = links[linkId] ?? links[String(linkId)];
    if (found) return found;
  }
  return null;
}

function getNode(graph, id) {
  return graph?.getNodeById?.(id) || null;
}

function allGraphs(root = app.graph) {
  if (!root) return [];
  const result = [root];
  const seen = new Set(result);
  const queue = [root];
  while (queue.length) {
    const graph = queue.shift();
    for (const node of graph?._nodes || []) {
      if (node?.subgraph && !seen.has(node.subgraph)) {
        seen.add(node.subgraph);
        result.push(node.subgraph);
        queue.push(node.subgraph);
      }
    }
  }
  return result;
}

function graphAncestors(graph) {
  if (!graph) return [];
  const root = graph.rootGraph || app.graph || graph;
  if (graph === root) return [graph];
  const result = [graph];
  const seen = new Set(result);
  let current = graph;
  while (current && current !== root) {
    let parent = current.parent || current._parent || current._subgraph_node?.graph || null;
    if (!parent) {
      for (const candidate of allGraphs(root)) {
        for (const node of candidate?._nodes || []) {
          if (node?.subgraph === current) {
            parent = candidate;
            break;
          }
        }
        if (parent) break;
      }
    }
    if (!parent || seen.has(parent)) break;
    seen.add(parent);
    result.push(parent);
    current = parent;
  }
  if (root && !result.includes(root)) result.push(root);
  return result;
}

function variableName(node) {
  return node?.widgets?.[0]?.value ?? node?.properties?.name ?? null;
}

function findSetter(getNode) {
  const name = variableName(getNode);
  if (!name) return null;
  for (const graph of graphAncestors(getNode.graph || app.graph)) {
    for (const node of graph?._nodes || []) {
      if (isSet(node) && variableName(node) === name) return { node, graph };
    }
  }
  return null;
}

function linkOrigin(link) {
  return {
    nodeId: link?.origin_id ?? link?.originId,
    slot: Number(link?.origin_slot ?? link?.originSlot ?? 0) || 0,
  };
}

function resolveUpstream(graph, linkId, seen = new Set()) {
  if (!graph || linkId == null) return null;
  const key = `${graph?.id || "g"}:${String(linkId)}`;
  if (seen.has(key)) return null;
  seen.add(key);

  const link = getLink(graph, linkId);
  if (!link) return null;
  const { nodeId, slot } = linkOrigin(link);
  const node = getNode(graph, nodeId);
  if (!node) return null;

  if (isReroute(node)) return resolveUpstream(graph, node.inputs?.[0]?.link, seen);

  if (isGet(node)) {
    const setter = findSetter(node);
    const setterLink = setter?.node?.inputs?.[0]?.link;
    if (!setter || setterLink == null) return null;
    return resolveUpstream(setter.graph, setterLink, seen);
  }

  return {
    node,
    graph,
    nodeId,
    slot,
    type: String(link.type || node.outputs?.[slot]?.type || "*").toUpperCase(),
  };
}

function resolveVirtualSource(graph, link) {
  const id = Number(link?.source_id);
  const slot = Number(link?.source_slot) || 0;
  const node = getNode(graph, id) || app.graph?.getNodeById?.(id);
  if (!node) return null;

  if (isGet(node)) {
    const setter = findSetter(node);
    if (!setter || setter.node?.inputs?.[0]?.link == null) return null;
    return resolveUpstream(setter.graph, setter.node.inputs[0].link);
  }
  if (isReroute(node) && node.inputs?.[0]?.link != null) {
    return resolveUpstream(node.graph || graph, node.inputs[0].link);
  }

  return {
    node,
    graph: node.graph || graph,
    nodeId: Number(node.id),
    slot,
    type: String(node.outputs?.[slot]?.type || link?.source_type || "*").toUpperCase(),
  };
}

function kindFor(type) {
  const upper = String(type || "").toUpperCase();
  if (upper.includes("VIDEO")) return "video";
  if (upper.includes("AUDIO")) return "audio";
  return "picture";
}

function collectPackMedia(pack) {
  const result = [];
  const graph = pack?.graph;
  if (!graph) return result;

  for (const input of pack.inputs || []) {
    if (input?.link == null) continue;
    const source = resolveUpstream(graph, input.link);
    if (!source) continue;
    const type = String(source.type || source.node?.outputs?.[source.slot]?.type || "*").toUpperCase();
    if (!MEDIA_TYPES.has(type)) continue;
    result.push({
      source_id: Number(source.nodeId),
      source_slot: Number(source.slot) || 0,
      source_type: type,
      kind: kindFor(type),
    });
  }
  return result;
}

function isBusVirtualLink(graph, link) {
  if (String(link?.source_type || "").toUpperCase() === BUS_TYPE) return true;
  const resolved = resolveVirtualSource(graph, link);
  return Boolean(resolved && (isPack(resolved.node) || resolved.type === BUS_TYPE));
}

function expandBusLink(graph, link) {
  const resolved = resolveVirtualSource(graph, link);
  if (!resolved) return [];
  if (isPack(resolved.node)) return collectPackMedia(resolved.node);
  return [];
}

function cloneVirtualLink(link) {
  return {
    source_id: Number(link?.source_id),
    source_slot: Number(link?.source_slot) || 0,
    source_type: String(link?.source_type || "*").toUpperCase(),
    kind: link?.kind || kindFor(link?.source_type),
  };
}

function getVisualState(node) {
  const state = node?.properties?.[VISUAL_STATE_PROP];
  if (!state || !Array.isArray(state.buses)) return null;
  return state;
}

function setVisualState(node, buses, direct) {
  node.properties ||= {};
  node.properties[VISUAL_STATE_PROP] = {
    buses: buses.map(cloneVirtualLink),
    direct: direct.map(cloneVirtualLink),
  };
}

function normalizeExpandedLinks(node, prop) {
  node.properties ||= {};
  const current = Array.isArray(node.properties[prop]) ? node.properties[prop] : [];
  const graph = node.graph || app.graph;
  let state = getVisualState(node);

  // First BUS connection: remember the compact visual source before expanding it.
  const incomingBuses = current.filter((link) => isBusVirtualLink(graph, link));
  if (incomingBuses.length) {
    const direct = current.filter((link) => !isBusVirtualLink(graph, link));
    setVisualState(node, incomingBuses, direct);
    state = getVisualState(node);
  }

  if (!state?.buses?.length) return false;

  // "Remove all reference inputs" clears the normal H3 link list. Treat that as
  // an explicit request to remove the remembered BUS as well.
  if (!current.length && state.direct?.length) {
    delete node.properties[VISUAL_STATE_PROP];
    return false;
  }

  const next = [];
  const seen = new Set();
  const push = (link) => {
    const id = Number(link?.source_id);
    const slot = Number(link?.source_slot) || 0;
    if (!Number.isFinite(id)) return;
    const key = `${id}:${slot}`;
    if (seen.has(key) || next.length >= MAX_MEDIA) return;
    seen.add(key);
    next.push(cloneVirtualLink(link));
  };

  for (const link of state.direct || []) push(link);
  for (const bus of state.buses) {
    for (const media of expandBusLink(graph, bus)) push(media);
  }

  const before = JSON.stringify(current);
  const after = JSON.stringify(next);
  if (before === after) return false;

  node.properties[prop] = next;
  node.__terryH3?.connectionChanged?.();
  node.__terryH3Editor?.refresh?.();
  node.__terryH3ShotTimeline?.refreshAssets?.();
  node.graph?.setDirtyCanvas?.(true, true);
  app.graph?.change?.();
  return true;
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

function drawBusOverlay(canvas, ctx, graph, node, buses) {
  if (!ctx || !buses?.length) return;
  const inputIndex = mediaInputIndex(node);
  if (inputIndex < 0) return;
  const end = connectionPos(node, true, inputIndex);

  for (const bus of buses) {
    const source = getNode(graph, Number(bus.source_id));
    if (!source) continue;
    const start = connectionPos(source, false, Number(bus.source_slot) || 0);
    const colors = globalThis.LGraphCanvas?.link_type_colors || {};
    const color = colors[BUS_TYPE] || colors[BUS_TYPE.toLowerCase()] || globalThis.LiteGraph?.LINK_COLOR || "#9A9";
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(start[0], start[1]);
    ctx.bezierCurveTo(start[0] + 80, start[1], end[0] - 80, end[1], end[0], end[1]);
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(6, (canvas?.connections_width || 3) * 2);
    ctx.globalAlpha *= 0.72;
    ctx.stroke();
    ctx.restore();
  }
}

function patchCanvas() {
  const canvas = app.canvas;
  if (!canvas || canvas.__terryH3BusVisualPatched || typeof canvas.drawConnections !== "function") return;
  canvas.__terryH3BusVisualPatched = true;
  const original = canvas.drawConnections;

  canvas.drawConnections = function(ctx) {
    const graph = this.graph || app.graph;
    const swaps = [];

    // H3's own virtual-link renderer reads its normal media link property. During
    // drawing only, temporarily swap that list back to direct links + one BUS link.
    for (const node of graph?._nodes || []) {
      const prop = TARGETS[nodeType(node)];
      if (!prop) continue;
      const state = getVisualState(node);
      if (!state?.buses?.length) continue;
      swaps.push({ node, prop, value: node.properties?.[prop], state });
      node.properties[prop] = [...(state.direct || []), ...state.buses].map(cloneVirtualLink);
    }

    let result;
    try {
      result = original.apply(this, arguments);
    } finally {
      for (const item of swaps) item.node.properties[item.prop] = item.value;
    }

    const drawCtx = ctx || this.bgctx || this.ctx;
    for (const item of swaps) drawBusOverlay(this, drawCtx, graph, item.node, item.state.buses);
    return result;
  };
}

function refreshAll() {
  patchCanvas();
  for (const graph of allGraphs()) {
    for (const node of graph?._nodes || []) {
      const prop = TARGETS[nodeType(node)];
      if (prop) normalizeExpandedLinks(node, prop);
    }
  }
}

let timer = null;
function start() {
  patchCanvas();
  if (timer) return;
  timer = setInterval(refreshAll, 200);
}

app.registerExtension({
  name: "TerryToolbox.H3WireBusBridge",
  setup() {
    start();
    queueMicrotask(refreshAll);
  },
  nodeCreated() {
    start();
  },
  loadedGraphNode() {
    start();
    queueMicrotask(refreshAll);
  },
  afterConfigureGraph() {
    start();
    queueMicrotask(refreshAll);
  },
});
