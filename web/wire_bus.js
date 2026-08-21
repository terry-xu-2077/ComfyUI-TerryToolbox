import { app } from "../../scripts/app.js";

const PACK_TYPE = "TerryWireBusPack";
const UNPACK_TYPE = "TerryWireBusUnpack";
const BUS_TYPE = "TERRY_WIRE_BUS";
const EMPTY_TYPE = "*";

function isPack(node) {
  return node?.type === PACK_TYPE || node?.constructor?.type === PACK_TYPE;
}

function isUnpack(node) {
  return node?.type === UNPACK_TYPE || node?.constructor?.type === UNPACK_TYPE;
}

function getLink(graph, linkId) {
  if (linkId == null) return null;
  return graph?.links?.[linkId] || graph?._links?.get?.(linkId) || null;
}

function getNode(graph, id) {
  return graph?.getNodeById?.(id) || null;
}

function isReroute(node) {
  const type = String(
    node?.type || node?.constructor?.type || node?.comfyClass || ""
  ).toLowerCase();
  return type === "reroute" || type.endsWith("reroute");
}

function resolveUpstream(graph, linkId, seen = new Set()) {
  if (linkId == null || seen.has(linkId)) return null;
  seen.add(linkId);
  const link = getLink(graph, linkId);
  if (!link) return null;
  const node = getNode(graph, link.origin_id);
  if (!node) return null;
  if (!isReroute(node)) {
    return {
      node,
      nodeId: link.origin_id,
      slot: link.origin_slot,
      type: link.type || node.outputs?.[link.origin_slot]?.type || EMPTY_TYPE,
      name:
        node.outputs?.[link.origin_slot]?.name ||
        node.outputs?.[link.origin_slot]?.label ||
        null,
    };
  }
  return resolveUpstream(graph, node.inputs?.[0]?.link, seen);
}

function collectDownstreamTargets(graph, node, outputSlot, seenNodes = new Set()) {
  const result = [];
  const links = node?.outputs?.[outputSlot]?.links || [];
  for (const linkId of links) {
    const link = getLink(graph, linkId);
    if (!link) continue;
    const target = getNode(graph, link.target_id);
    if (!target) continue;
    if (isReroute(target)) {
      const key = String(target.id);
      if (seenNodes.has(key)) continue;
      seenNodes.add(key);
      result.push(...collectDownstreamTargets(graph, target, 0, seenNodes));
      continue;
    }
    result.push({ node: target, nodeId: link.target_id, slot: link.target_slot });
  }
  return result;
}

function findPackFromUnpack(unpack) {
  const graph = unpack?.graph;
  const busLinkId = unpack?.inputs?.[0]?.link;
  if (!graph || busLinkId == null) return null;
  const upstream = resolveUpstream(graph, busLinkId);
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
      packSlot: i,
      type: source.type || input.type || EMPTY_TYPE,
      name:
        source.name || input.label || input.name || `输入 ${entries.length + 1}`,
    });
  }
  return entries;
}

function disconnectAllOutputLinks(node, outputIndex) {
  const links = [...(node.outputs?.[outputIndex]?.links || [])];
  for (const linkId of links) {
    const link = getLink(node.graph, linkId);
    if (!link) continue;
    const target = getNode(node.graph, link.target_id);
    if (target) node.disconnectOutput?.(outputIndex, target, link.target_slot);
  }
}

function syncUnpack(unpack) {
  const pack = findPackFromUnpack(unpack);
  const entries = pack ? connectedPackEntries(pack) : [];

  const outgoing = (unpack.outputs || []).map((_, index) =>
    collectDownstreamTargets(unpack.graph, unpack, index)
  );

  for (let i = (unpack.outputs?.length || 0) - 1; i >= 0; i--) {
    disconnectAllOutputLinks(unpack, i);
    unpack.removeOutput?.(i);
  }

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    unpack.addOutput(entry.name || `输出 ${i + 1}`, entry.type || EMPTY_TYPE);
  }

  for (let i = 0; i < Math.min(outgoing.length, unpack.outputs?.length || 0); i++) {
    for (const target of outgoing[i]) {
      try {
        unpack.connect(i, target.node, target.slot);
      } catch (error) {
        console.warn("[Terry Wire Bus] Failed to restore output link", error);
      }
    }
  }

  unpack.setSize?.([
    Math.max(190, unpack.size?.[0] || 190),
    Math.max(80, unpack.computeSize?.()?.[1] || 80),
  ]);
  unpack.graph?.setDirtyCanvas?.(true, true);
}

function syncUnpacksFromPack(pack) {
  const graph = pack?.graph;
  if (!graph) return;
  const targets = collectDownstreamTargets(graph, pack, 0);
  for (const target of targets) {
    if (isUnpack(target.node)) syncUnpack(target.node);
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

  // 始终在底部保留一个通配输入口，连接后自动继续增长。
  for (let i = (pack.inputs?.length || 0) - 2; i >= 0; i--) {
    if (pack.inputs[i]?.link == null) pack.removeInput?.(i);
  }
  const last = pack.inputs?.[pack.inputs.length - 1];
  if (!last || last.link != null || last.type !== EMPTY_TYPE) {
    pack.addInput("添加线束", EMPTY_TYPE);
  } else {
    last.name = "添加线束";
    last.label = last.name;
    last.type = EMPTY_TYPE;
  }

  pack.setSize?.([
    Math.max(190, pack.size?.[0] || 190),
    Math.max(80, pack.computeSize?.()?.[1] || 80),
  ]);
  syncUnpacksFromPack(pack);
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
      const graph = this.graph || app.graph;
      if (!prompt || !graph) return result;

      for (const unpack of graph._nodes || graph.nodes || []) {
        if (!isUnpack(unpack)) continue;
        const pack = findPackFromUnpack(unpack);
        if (!pack) continue;
        const entries = connectedPackEntries(pack);

        for (let outputIndex = 0; outputIndex < entries.length; outputIndex++) {
          const source = entries[outputIndex]?.source;
          if (!source) continue;
          const targets = collectDownstreamTargets(graph, unpack, outputIndex);
          for (const target of targets) {
            if (
              isPack(target.node) ||
              isUnpack(target.node) ||
              isReroute(target.node)
            ) {
              continue;
            }
            const targetPrompt =
              prompt[String(target.nodeId)] || prompt[target.nodeId];
            const input = target.node?.inputs?.[target.slot];
            if (!targetPrompt?.inputs || !input?.name) continue;
            targetPrompt.inputs[input.name] = [String(source.nodeId), source.slot];
          }
        }
      }
    } catch (error) {
      console.error("[Terry Wire Bus] Failed to expand virtual bus", error);
      throw error;
    }
    return result;
  };
}

app.registerExtension({
  name: "Terry.WireBus",

  async setup() {
    patchGraphToPrompt();
  },

  registerCustomNodes() {
    const BaseNode = LiteGraph.LGraphNode || window.LGraphNode;
    if (!BaseNode) {
      console.error("[Terry Wire Bus] LGraphNode base class is unavailable");
      return;
    }

    class TerryWireBusPack extends BaseNode {
      constructor() {
        super("Terry | 线束汇总");
        this.title = "Terry | 线束汇总";
        this.addInput("添加线束", EMPTY_TYPE);
        this.addOutput("总线", BUS_TYPE);
        this.isVirtualNode = true;
        this.serialize_widgets = false;
        this.size = [210, 90];
      }

      // Prompt 展开由 graphToPrompt 补丁统一处理。
      applyToGraph() {}

      onConnectionsChange(type, index) {
        if (app.configuringGraph) return;
        if (type === LiteGraph.INPUT) {
          queueMicrotask(() => refreshPackSlots(this));
        } else if (type === LiteGraph.OUTPUT) {
          queueMicrotask(() => syncUnpacksFromPack(this));
        }
      }

      onConnectInput(slot, type) {
        if (slot < 0) return false;
        return type !== BUS_TYPE;
      }

      onConnectOutput(slot, type, input, targetNode) {
        return slot === 0 && (isUnpack(targetNode) || isReroute(targetNode));
      }

      onConfigure() {
        queueMicrotask(() => refreshPackSlots(this));
      }
    }

    class TerryWireBusUnpack extends BaseNode {
      constructor() {
        super("Terry | 线束还原");
        this.title = "Terry | 线束还原";
        this.addInput("总线", BUS_TYPE);
        this.isVirtualNode = true;
        this.serialize_widgets = false;
        this.size = [210, 80];
      }

      applyToGraph() {}

      onConnectionsChange(type, index) {
        if (app.configuringGraph) return;
        if (type === LiteGraph.INPUT && index === 0) {
          queueMicrotask(() => syncUnpack(this));
        }
      }

      onConnectInput(slot, type, output, originNode) {
        if (slot !== 0) return false;
        return type === BUS_TYPE || isPack(originNode) || isReroute(originNode);
      }

      onConfigure() {
        queueMicrotask(() => syncUnpack(this));
      }
    }

    Object.assign(TerryWireBusPack, {
      title: "Terry | 线束汇总",
      desc: "将任意数量、任意类型的线束汇总为一根总线。",
    });
    TerryWireBusPack.category = "Terry Toolbox/线束整理";

    Object.assign(TerryWireBusUnpack, {
      title: "Terry | 线束还原",
      desc: "自动恢复总线中的线束数量、类型和原始顺序。",
    });
    TerryWireBusUnpack.category = "Terry Toolbox/线束整理";

    LiteGraph.registerNodeType(PACK_TYPE, TerryWireBusPack);
    LiteGraph.registerNodeType(UNPACK_TYPE, TerryWireBusUnpack);
  },

  afterConfigureGraph() {
    patchGraphToPrompt();
    for (const node of app.graph?._nodes || []) {
      if (isPack(node)) refreshPackSlots(node);
      if (isUnpack(node)) syncUnpack(node);
    }
  },
});
