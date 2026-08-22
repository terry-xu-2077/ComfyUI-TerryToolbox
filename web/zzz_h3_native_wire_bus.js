import { app } from "../../scripts/app.js";

const BUS_TYPE = "TERRY_WIRE_BUS";
const PACK_TYPE = "TerryWireBusPack";
const MEDIA_TYPES = new Set(["IMAGE", "VIDEO", "AUDIO"]);
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

function getLink(graph, id) {
  if (!graph || id == null) return null;
  for (const links of [graph.links, graph._links]) {
    if (!links) continue;
    if (typeof links.get === "function") {
      const hit = links.get(id) ?? links.get(String(id));
      if (hit) return hit;
    }
    const hit = links[id] ?? links[String(id)];
    if (hit) return hit;
  }
  return null;
}

function getNode(graph, id) {
  return graph?.getNodeById?.(id) || app.graph?.getNodeById?.(id) || null;
}

function isReroute(node) {
  const type = nodeType(node).toLowerCase();
  return type === "reroute" || type.endsWith("reroute");
}
function isGet(node) { return nodeType(node) === "GetNode"; }
function isSet(node) { return nodeType(node) === "SetNode"; }

function variableName(node) {
  return node?.widgets?.[0]?.value ?? node?.properties?.name ?? null;
}

function findSetter(getNode) {
  const name = variableName(getNode);
  if (!name) return null;
  const graph = getNode?.graph || app.graph;
  for (const node of graph?._nodes || []) {
    if (isSet(node) && variableName(node) === name) return node;
  }
  for (const node of app.graph?._nodes || []) {
    if (isSet(node) && variableName(node) === name) return node;
  }
  return null;
}

function resolveUpstream(graph, linkId, seen = new Set()) {
  if (!graph || linkId == null) return null;
  const key = `${String(graph?.id || "g")}:${String(linkId)}`;
  if (seen.has(key)) return null;
  seen.add(key);
  const link = getLink(graph, linkId);
  if (!link) return null;
  const id = link.origin_id ?? link.originId ?? link.from_id ?? link.fromId;
  const slot = Number(link.origin_slot ?? link.originSlot ?? link.from_slot ?? link.fromSlot ?? 0) || 0;
  const node = getNode(graph, id);
  if (!node) return null;
  if (isReroute(node)) return resolveUpstream(node.graph || graph, node.inputs?.[0]?.link, seen);
  if (isGet(node)) {
    const setter = findSetter(node);
    if (setter?.inputs?.[0]?.link != null) return resolveUpstream(setter.graph || graph, setter.inputs[0].link, seen);
  }
  return {
    node,
    nodeId: Number(node.id),
    slot,
    type: String(link.type || node.outputs?.[slot]?.type || "*").toUpperCase(),
  };
}

function kindFor(type) {
  const value = String(type || "").toUpperCase();
  if (value.includes("VIDEO")) return "video";
  if (value.includes("AUDIO")) return "audio";
  return "picture";
}

function mediaInputIndex(node) {
  return node?.inputs?.findIndex?.((input) => String(input?.name || "") === "media") ?? -1;
}

function nativeBusPack(node) {
  const index = mediaInputIndex(node);
  const input = node?.inputs?.[index];
  if (!input || input.link == null) return null;
  const source = resolveUpstream(node.graph || app.graph, input.link);
  if (!source) return null;
  return nodeType(source.node) === PACK_TYPE || source.type === BUS_TYPE ? source.node : null;
}

// Nodes 2.0 can fire onConnectionsChange before the new link is fully visible in
// graph.links. Detect a BUS directly from the callback payload so the H3 legacy
// virtual-reference converter cannot immediately disconnect the native BUS.
function busFromLinkInfo(node, linkInfo) {
  if (!linkInfo) return null;
  const directType = String(
    linkInfo.type ?? linkInfo.dataType ?? linkInfo.output_type ?? linkInfo.outputType ?? ""
  ).toUpperCase();
  if (directType === BUS_TYPE) return true;

  const graph = node?.graph || app.graph;
  const originId = linkInfo.origin_id ?? linkInfo.originId ?? linkInfo.from_id ?? linkInfo.fromId;
  const originSlot = Number(linkInfo.origin_slot ?? linkInfo.originSlot ?? linkInfo.from_slot ?? linkInfo.fromSlot ?? 0) || 0;
  const originNode = linkInfo.origin_node ?? linkInfo.originNode ?? linkInfo.fromNode ?? getNode(graph, originId);
  if (!originNode) return null;
  const originType = String(originNode.outputs?.[originSlot]?.type || directType || "").toUpperCase();
  if (originType === BUS_TYPE || nodeType(originNode) === PACK_TYPE) return true;

  if (isReroute(originNode) && originNode.inputs?.[0]?.link != null) {
    const resolved = resolveUpstream(originNode.graph || graph, originNode.inputs[0].link);
    if (resolved && (resolved.type === BUS_TYPE || nodeType(resolved.node) === PACK_TYPE)) return true;
  }
  if (isGet(originNode)) {
    const setter = findSetter(originNode);
    if (setter?.inputs?.[0]?.link != null) {
      const resolved = resolveUpstream(setter.graph || graph, setter.inputs[0].link);
      if (resolved && (resolved.type === BUS_TYPE || nodeType(resolved.node) === PACK_TYPE)) return true;
    }
  }
  return null;
}

function collectBusMedia(node) {
  const pack = nativeBusPack(node);
  if (!pack?.graph) return [];
  const out = [];
  const seen = new Set();
  for (const input of pack.inputs || []) {
    if (input?.link == null) continue;
    const source = resolveUpstream(pack.graph, input.link);
    if (!source) continue;
    const type = String(source.type || source.node?.outputs?.[source.slot]?.type || "*").toUpperCase();
    if (!MEDIA_TYPES.has(type)) continue;
    const key = `${source.nodeId}:${source.slot}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      source_id: Number(source.nodeId),
      source_slot: Number(source.slot) || 0,
      source_type: type,
      kind: kindFor(type),
    });
  }
  return out;
}

function cloneLink(link) {
  return {
    source_id: Number(link?.source_id),
    source_slot: Number(link?.source_slot) || 0,
    source_type: String(link?.source_type || "*"),
    kind: link?.kind || kindFor(link?.source_type),
  };
}

function uniqueLinks(links) {
  const result = [];
  const seen = new Set();
  for (const link of links || []) {
    const id = Number(link?.source_id);
    const slot = Number(link?.source_slot) || 0;
    if (!Number.isFinite(id)) continue;
    const key = `${id}:${slot}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cloneLink(link));
  }
  return result;
}

function refreshNode(node) {
  node.__terryH3?.connectionChanged?.();
  node.__terryH3Editor?.refresh?.();
  node.__terryH3ShotTimeline?.refreshAssets?.();
  node.setDirtyCanvas?.(true, true);
  node.graph?.setDirtyCanvas?.(true, true);
}

function installReferenceView(node) {
  const prop = TARGETS[nodeType(node)];
  if (!prop || node.__terryNativeBusInstalled) return;
  node.__terryNativeBusInstalled = true;
  node.properties ||= {};
  delete node.properties.terry_h3_wire_bus_visual_state;

  const initial = Array.isArray(node.properties[prop]) ? node.properties[prop].map(cloneLink) : [];
  const state = {
    direct: uniqueLinks(initial.filter((link) => String(link?.source_type || "").toUpperCase() !== BUS_TYPE)),
    signature: "",
  };

  const busKeys = () => new Set(collectBusMedia(node).map((x) => `${x.source_id}:${x.source_slot}`));

  Object.defineProperty(node.properties, prop, {
    configurable: true,
    enumerable: true,
    get() {
      if (globalThis.__terryH3NativeBusDrawing) return state.direct.map(cloneLink);
      return uniqueLinks([...state.direct, ...collectBusMedia(node)]);
    },
    set(value) {
      const bus = busKeys();
      state.direct = uniqueLinks(Array.isArray(value) ? value : []).filter((link) => {
        if (String(link?.source_type || "").toUpperCase() === BUS_TYPE) return false;
        return !bus.has(`${Number(link?.source_id)}:${Number(link?.source_slot) || 0}`);
      });
    },
  });

  const originalDisconnect = node.disconnectInput;
  if (typeof originalDisconnect === "function") {
    node.disconnectInput = function(index) {
      const mediaIndex = mediaInputIndex(this);
      // Protection is based on the connection event marker, not on graph lookup.
      // This is required for Nodes 2.0, where graph.links may lag the callback.
      if (index === mediaIndex && performance.now() < Number(this.__terryProtectBusUntil || 0)) {
        return;
      }
      return originalDisconnect.apply(this, arguments);
    };
  }

  const originalConnections = node.onConnectionsChange;
  node.onConnectionsChange = function(type, index, connected, linkInfo) {
    const input = this.inputs?.[index];
    const isMedia = String(input?.name || "") === "media";
    const busConnected = isMedia && connected && (busFromLinkInfo(this, linkInfo) || nativeBusPack(this));
    if (busConnected) {
      // H3's own handler schedules convertConnection(..., 0). Keep the guard long
      // enough to cover that timer in both legacy canvas and Nodes 2.0.
      this.__terryProtectBusUntil = performance.now() + 750;
    }
    const result = originalConnections?.apply(this, arguments);
    if (isMedia) queueMicrotask(() => refreshNode(this));
    return result;
  };

  node.__terryNativeBus = {
    getDirectLinks: () => state.direct.map(cloneLink),
    setDirectLinks: (links) => {
      state.direct = uniqueLinks(links);
      refreshNode(node);
      node.graph?.change?.();
    },
    hasBus: () => Boolean(nativeBusPack(node)),
    disconnectBus: () => {
      const index = mediaInputIndex(node);
      if (index < 0 || node.inputs?.[index]?.link == null) return false;
      node.__terryProtectBusUntil = 0;
      originalDisconnect?.call(node, index);
      refreshNode(node);
      node.graph?.change?.();
      return true;
    },
  };
}

function patchAll() {
  for (const node of app.graph?._nodes || []) installReferenceView(node);
}

function patchCanvas() {
  const canvas = app.canvas;
  if (!canvas || typeof canvas.drawConnections !== "function") return;
  const current = canvas.drawConnections;
  if (current.__terryNativeBusDrawGuard) return;
  function guardedDrawConnections() {
    globalThis.__terryH3NativeBusDrawing = (globalThis.__terryH3NativeBusDrawing || 0) + 1;
    try {
      return current.apply(this, arguments);
    } finally {
      globalThis.__terryH3NativeBusDrawing = Math.max(0, Number(globalThis.__terryH3NativeBusDrawing || 1) - 1);
    }
  }
  guardedDrawConnections.__terryNativeBusDrawGuard = true;
  canvas.drawConnections = guardedDrawConnections;
}

let timer = null;
function start() {
  patchAll();
  patchCanvas();
  if (timer) return;
  timer = setInterval(() => {
    patchAll();
    patchCanvas();
    for (const node of app.graph?._nodes || []) {
      const prop = TARGETS[nodeType(node)];
      if (!prop || !node.__terryNativeBus) continue;
      const signature = collectBusMedia(node).map((x) => `${x.source_id}:${x.source_slot}:${x.source_type}`).join("|");
      if (node.__terryNativeBusSignature !== signature) {
        node.__terryNativeBusSignature = signature;
        refreshNode(node);
      }
    }
  }, 300);
}

app.registerExtension({
  name: "TerryToolbox.H3NativeWireBus",
  setup() {
    start();
    queueMicrotask(() => { patchAll(); patchCanvas(); });
    setTimeout(() => { patchAll(); patchCanvas(); }, 0);
  },
  nodeCreated(node) {
    queueMicrotask(() => installReferenceView(node));
  },
  loadedGraphNode(node) {
    queueMicrotask(() => installReferenceView(node));
  },
  afterConfigureGraph() {
    queueMicrotask(() => { patchAll(); patchCanvas(); });
  },
});
