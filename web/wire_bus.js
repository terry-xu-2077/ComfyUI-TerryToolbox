import { app } from "../../scripts/app.js";

const PACK_TYPE = "Terry | 线束汇总";
const UNPACK_TYPE = "Terry | 线束还原";
const BUS_TYPE = "TERRY_WIRE_BUS";
const EMPTY_TYPE = "*";

function nodeType(node) {
  return String(node?.type || node?.constructor?.type || node?.comfyClass || node?.constructor?.comfyClass || "");
}

function isPack(node) { return nodeType(node) === PACK_TYPE; }
function isUnpack(node) { return nodeType(node) === UNPACK_TYPE; }
function isReroute(node) {
  const t = nodeType(node).toLowerCase();
  return t === "reroute" || t.endsWith("reroute");
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
  const chain = [graph];
  const seen = new Set(chain);
  let current = graph;
  while (current && current !== root) {
    let parent = current.parent || current._parent || current._subgraph_node?.graph || null;
    if (!parent && root?._nodes) {
      for (const node of root._nodes) {
        if (node?.subgraph === current) { parent = root; break; }
      }
    }
    if (!parent || seen.has(parent)) break;
    seen.add(parent);
    chain.push(parent);
    current = parent;
  }
  if (root && !chain.includes(root)) chain.push(root);
  return chain;
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

  if (isReroute(node)) {
    return resolveUpstream(graph, node.inputs?.[0]?.link, seen);
  }

  if (isGet(node)) {
    const setter = findSetter(node);
    const setterLink = setter?.node?.inputs?.[0]?.link;
    if (!setter || setterLink == null) return null;
    return resolveUpstream(setter.graph, setterLink, seen);
  }

  const output = node.outputs?.[slot];
  return {
    node,
    graph,
    nodeId,
    slot,
    type: link.type || output?.type || EMPTY_TYPE,
    name: output?.name || output?.label || null,
  };
}

function collectDownstreamTargets(graph, node, outputSlot, seenNodes = new Set()) {
  const result = [];
  for (const linkId of node?.outputs?.[outputSlot]?.links || []) {
    const link = getLink(graph, linkId);
    if (!link) continue;
    const targetId = link.target_id ?? link.targetId;
    const targetSlot = Number(link.target_slot ?? link.targetSlot ?? 0) || 0;
    const target = getNode(graph, targetId);
    if (!target) continue;
    if (isReroute(target)) {
      const key = `${graph?.id || "g"}:${target.id}`;
      if (seenNodes.has(key)) continue;
      seenNodes.add(key);
      result.push(...collectDownstreamTargets(graph, target, 0, seenNodes));
      continue;
    }
    result.push({ node: target, nodeId: targetId, slot: targetSlot, graph });
  }
  return result;
}

function findPackFromUnpack(unpack) {
  const graph = unpack?.graph;
  const linkId = unpack?.inputs?.[0]?.link;
  if (!graph || linkId == null) return null;
  const upstream = resolveUpstream(graph, linkId);
  return upstream && isPack(upstream.node) ? upstream.node : null;
}

function connectedPackEntries(pack) {
  const graph = pack?.graph;
  if (!graph) return [];
  const entries = [];
  for (let i = 0; i < (pack.inputs?.length || 0); i++) {
    const input = pack.inputs[i];
    if (!input || input.link == null) continue;
    const source = resolveUpstream(graph, input.link);
    if (!source) continue;
    entries.push({
      source,
      type: source.type || input.type || EMPTY_TYPE,
      name: source.name || input.label || input.name || `输入 ${entries.length + 1}`,
    });
  }
  return entries;
}

function disconnectAllOutputLinks(node, outputIndex) {
  for (const linkId of [...(node.outputs?.[outputIndex]?.links || [])]) {
    const link = getLink(node.graph, linkId);
    if (!link) continue;
    const target = getNode(node.graph, link.target_id ?? link.targetId);
    if (target) node.disconnectOutput?.(outputIndex, target, link.target_slot ?? link.targetSlot ?? 0);
  }
}

function signatureForEntries(entries) {
  return entries.map((e) => `${e.source?.nodeId}:${e.source?.slot}:${e.type}:${e.name}`).join("|");
}

function syncUnpack(unpack, force = false) {
  const pack = findPackFromUnpack(unpack);
  const entries = pack ? connectedPackEntries(pack) : [];
  const signature = signatureForEntries(entries);
  if (!force && unpack.__terryBusSignature === signature) return;
  unpack.__terryBusSignature = signature;

  const outgoing = (unpack.outputs || []).map((_, index) =>
    collectDownstreamTargets(unpack.graph, unpack, index)
  );

  for (let i = (unpack.outputs?.length || 0) - 1; i >= 0; i--) {
    disconnectAllOutputLinks(unpack, i);
    unpack.removeOutput?.(i);
  }

  entries.forEach((entry, i) => unpack.addOutput(entry.name || `输出 ${i + 1}`, entry.type || EMPTY_TYPE));

  for (let i = 0; i < Math.min(outgoing.length, unpack.outputs?.length || 0); i++) {
    for (const target of outgoing[i]) {
      try { unpack.connect(i, target.node, target.slot); }
      catch (error) { console.warn("[Terry Wire Bus] 恢复输出连接失败", error); }
    }
  }

  unpack.setSize?.([
    Math.max(190, unpack.size?.[0] || 190),
    Math.max(80, unpack.computeSize?.()?.[1] || 80),
  ]);
  unpack.graph?.setDirtyCanvas?.(true, true);
}

function syncAllUnpacks() {
  for (const graph of allGraphs()) {
    for (const node of graph?._nodes || []) if (isUnpack(node)) syncUnpack(node);
  }
}

function refreshPackSlots(pack) {
  if (!pack?.graph || app.configuringGraph) return;

  for (let i = 0; i < (pack.inputs?.length || 0); i++) {
    const input = pack.inputs[i];
    if (!input || input.link == null) continue;
    const source = resolveUpstream(pack.graph, input.link);
    if (!source) continue;
    input.type = source.type || EMPTY_TYPE;
    input.name = source.name || `输入 ${i + 1}`;
    input.label = input.name;
  }

  for (let i = (pack.inputs?.length || 0) - 2; i >= 0; i--) {
    if (pack.inputs[i]?.link == null) pack.removeInput?.(i);
  }
  const last = pack.inputs?.[pack.inputs.length - 1];
  if (!last || last.link != null || last.type !== EMPTY_TYPE) {
    pack.addInput("添加线束", EMPTY_TYPE);
  } else {
    last.name = "添加线束";
    last.label = "添加线束";
    last.type = EMPTY_TYPE;
  }

  pack.setSize?.([
    Math.max(190, pack.size?.[0] || 190),
    Math.max(80, pack.computeSize?.()?.[1] || 80),
  ]);
  queueMicrotask(syncAllUnpacks);
  pack.graph?.setDirtyCanvas?.(true, true);
}

function patchGraphToPrompt() {
  if (app.__terryWireBusPatched) return;
  app.__terryWireBusPatched = true;
  const original = app.graphToPrompt?.bind(app);
  if (!original) return;

  app.graphToPrompt = async function (...args) {
    const result = await original(...args);
    try {
      const prompt = result?.output;
      if (!prompt) return result;

      for (const graph of allGraphs(this.graph || app.graph)) {
        for (const unpack of graph?._nodes || []) {
          if (!isUnpack(unpack)) continue;
          const pack = findPackFromUnpack(unpack);
          if (!pack) continue;
          const entries = connectedPackEntries(pack);

          for (let outputIndex = 0; outputIndex < entries.length; outputIndex++) {
            const source = entries[outputIndex]?.source;
            if (!source) continue;
            for (const target of collectDownstreamTargets(graph, unpack, outputIndex)) {
              if (isPack(target.node) || isUnpack(target.node) || isReroute(target.node) || isGet(target.node) || isSet(target.node)) continue;
              const targetPrompt = prompt[String(target.nodeId)] || prompt[target.nodeId];
              const input = target.node?.inputs?.[target.slot];
              if (!targetPrompt?.inputs || !input?.name) continue;
              targetPrompt.inputs[input.name] = [String(source.nodeId), source.slot];
            }
          }
        }
      }
    } catch (error) {
      console.error("[Terry Wire Bus] 展开虚拟总线失败", error);
      throw error;
    }
    return result;
  };
}

let bridgeTimer = null;
function startBridge() {
  if (bridgeTimer) return;
  bridgeTimer = setInterval(syncAllUnpacks, 300);
}

app.registerExtension({
  name: "Terry.WireBus",

  async setup() {
    patchGraphToPrompt();
    startBridge();
  },

  registerCustomNodes() {
    const BaseNode = LiteGraph.LGraphNode || window.LGraphNode;
    if (!BaseNode) {
      console.error("[Terry Wire Bus] 找不到 LGraphNode 基类");
      return;
    }

    class TerryWireBusPackNode extends BaseNode {
      constructor() {
        super(PACK_TYPE);
        this.title = PACK_TYPE;
        this.addInput("添加线束", EMPTY_TYPE);
        this.addOutput("总线", BUS_TYPE);
        this.isVirtualNode = true;
        this.serialize_widgets = false;
        this.size = [210, 90];
      }
      applyToGraph() {}
      onConnectionsChange(type) {
        if (app.configuringGraph) return;
        if (type === LiteGraph.INPUT) queueMicrotask(() => refreshPackSlots(this));
        else queueMicrotask(syncAllUnpacks);
      }
      onConnectInput(slot, type) { return slot >= 0 && type !== BUS_TYPE; }
      onConnectOutput(slot, type, input, targetNode) {
        return slot === 0 && (isUnpack(targetNode) || isReroute(targetNode) || isSet(targetNode));
      }
      onConfigure() { queueMicrotask(() => refreshPackSlots(this)); }
    }

    class TerryWireBusUnpackNode extends BaseNode {
      constructor() {
        super(UNPACK_TYPE);
        this.title = UNPACK_TYPE;
        this.addInput("总线", BUS_TYPE);
        this.isVirtualNode = true;
        this.serialize_widgets = false;
        this.size = [210, 80];
      }
      applyToGraph() {}
      onConnectionsChange(type, index) {
        if (app.configuringGraph) return;
        if (type === LiteGraph.INPUT && index === 0) queueMicrotask(() => syncUnpack(this, true));
      }
      onConnectInput(slot, type, output, originNode) {
        return slot === 0 && (type === BUS_TYPE || isPack(originNode) || isReroute(originNode) || isGet(originNode));
      }
      onConfigure() { queueMicrotask(() => syncUnpack(this, true)); }
    }

    Object.assign(TerryWireBusPackNode, {
      title: PACK_TYPE,
      desc: "将任意数量、任意类型的线束汇总成一根总线；支持 KJNodes Get/Set。",
    });
    TerryWireBusPackNode.category = "Terry Toolbox/线束整理";

    Object.assign(TerryWireBusUnpackNode, {
      title: UNPACK_TYPE,
      desc: "从总线自动恢复原始线束的数量、类型与顺序；支持 KJNodes Get/Set。",
    });
    TerryWireBusUnpackNode.category = "Terry Toolbox/线束整理";

    LiteGraph.registerNodeType(PACK_TYPE, TerryWireBusPackNode);
    LiteGraph.registerNodeType(UNPACK_TYPE, TerryWireBusUnpackNode);
  },

  afterConfigureGraph() {
    patchGraphToPrompt();
    startBridge();
    for (const graph of allGraphs()) {
      for (const node of graph?._nodes || []) {
        if (isPack(node)) refreshPackSlots(node);
        if (isUnpack(node)) syncUnpack(node, true);
      }
    }
  },
});
