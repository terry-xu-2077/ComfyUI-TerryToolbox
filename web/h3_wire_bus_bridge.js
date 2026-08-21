import { app } from "../../scripts/app.js";

const PACK_TYPE = "TerryWireBusPack";
const BUS_TYPE = "TERRY_WIRE_BUS";
const MEDIA_TYPES = new Set(["IMAGE", "VIDEO", "AUDIO"]);
const MAX_MEDIA = 32;

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

function normalizeExpandedLinks(node, prop) {
  node.properties ||= {};
  const original = Array.isArray(node.properties[prop]) ? node.properties[prop] : [];
  if (!original.length) return false;

  const graph = node.graph || app.graph;
  const next = [];
  const seen = new Set();
  let foundBus = false;

  const push = (link) => {
    const id = Number(link?.source_id);
    const slot = Number(link?.source_slot) || 0;
    if (!Number.isFinite(id)) return;
    const key = `${id}:${slot}`;
    if (seen.has(key) || next.length >= MAX_MEDIA) return;
    seen.add(key);
    next.push({
      source_id: id,
      source_slot: slot,
      source_type: String(link?.source_type || "*").toUpperCase(),
      kind: link?.kind || kindFor(link?.source_type),
    });
  };

  for (const link of original) {
    if (!isBusVirtualLink(graph, link)) {
      push(link);
      continue;
    }
    foundBus = true;
    for (const media of expandBusLink(graph, link)) push(media);
  }

  if (!foundBus) return false;
  const before = JSON.stringify(original);
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

function refreshAll() {
  for (const graph of allGraphs()) {
    for (const node of graph?._nodes || []) {
      const prop = TARGETS[nodeType(node)];
      if (prop) normalizeExpandedLinks(node, prop);
    }
  }
}

let timer = null;
function start() {
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
