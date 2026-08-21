import { app } from "../../scripts/app.js";

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

function propFor(node) {
  return TARGETS[nodeType(node)] || null;
}

function localeIsZh() {
  try {
    const raw = app?.ui?.settings?.getSettingValue?.("Comfy.Locale");
    const locale = String(raw || navigator.language || "en").toLowerCase().replaceAll("_", "-");
    return locale === "zh" || locale.startsWith("zh-");
  } catch {
    return String(navigator.language || "en").toLowerCase().startsWith("zh");
  }
}

function text(zh, en) {
  return localeIsZh() ? zh : en;
}

function linksOf(node) {
  const prop = propFor(node);
  if (!prop) return [];
  node.properties ||= {};
  if (!Array.isArray(node.properties[prop])) node.properties[prop] = [];
  return node.properties[prop];
}

function refreshNode(node) {
  node.__terryH3?.connectionChanged?.();
  node.__terryH3Editor?.refresh?.();
  node.__terryH3ShotTimeline?.refreshAssets?.();
  node.setDirtyCanvas?.(true, true);
  node.graph?.setDirtyCanvas?.(true, true);
}

function setLinks(node, next) {
  const prop = propFor(node);
  if (!prop) return;
  node.properties ||= {};
  node.properties[prop] = Array.isArray(next) ? next : [];
  refreshNode(node);
  node.graph?.change?.();
  app.graph?.change?.();
}

function clearLinks(node) {
  if (!linksOf(node).length) return false;
  setLinks(node, []);
  return true;
}

function sourceLabel(node, link, index) {
  const graph = node?.graph || app.graph;
  const source = graph?.getNodeById?.(Number(link?.source_id));
  const slot = Number(link?.source_slot) || 0;
  const output = source?.outputs?.[slot];
  const name = String(output?.label || output?.name || source?.title || "").trim();
  const type = String(output?.type || link?.source_type || "").trim();
  return name || type || `${text("参考", "Reference")} ${index + 1}`;
}

function removeOne(node, index) {
  const links = [...linksOf(node)];
  if (index < 0 || index >= links.length) return;
  links.splice(index, 1);
  setLinks(node, links);
}

function mediaInputIndex(node) {
  return node?.inputs?.findIndex?.((input) => {
    const name = String(input?.name || "").toLowerCase();
    const label = String(input?.label || input?.localized_name || "").toLowerCase();
    return name === "media" || name === "asset" || label.includes("多路输入") || label.includes("multi-input");
  }) ?? -1;
}

function eventLocalPos(node, event, pos) {
  if (Array.isArray(pos) && pos.length >= 2) return pos;
  const canvas = app.canvas;
  const mouse = canvas?.graph_mouse;
  if (Array.isArray(mouse) && mouse.length >= 2 && node?.pos) {
    return [mouse[0] - node.pos[0], mouse[1] - node.pos[1]];
  }
  return null;
}

function hitMediaSocket(node, event, pos) {
  const index = mediaInputIndex(node);
  if (index < 0 || !linksOf(node).length) return false;
  const local = eventLocalPos(node, event, pos);
  if (!local) return false;

  // getInputPos returns graph-space coordinates, while onMouseDown pos is normally node-local.
  const graphPos = node.getInputPos?.(index);
  if (!graphPos) return false;
  const socketLocal = [graphPos[0] - (node.pos?.[0] || 0), graphPos[1] - (node.pos?.[1] || 0)];
  const dx = local[0] - socketLocal[0];
  const dy = local[1] - socketLocal[1];
  return dx * dx + dy * dy <= 18 * 18;
}

function installNode(nodeType, nodeData) {
  if (!TARGETS[nodeData?.name] || nodeType.prototype.__terryVirtualMediaDisconnect) return;
  nodeType.prototype.__terryVirtualMediaDisconnect = true;

  const oldMouseDown = nodeType.prototype.onMouseDown;
  nodeType.prototype.onMouseDown = function (event, pos, canvas) {
    // Native-looking behavior for the virtual multi-input socket: clicking the socket
    // disconnects the virtual bundle because there is no real LiteGraph link to grab.
    if ((event?.button ?? 0) === 0 && hitMediaSocket(this, event, pos)) {
      clearLinks(this);
      event?.preventDefault?.();
      event?.stopPropagation?.();
      return true;
    }
    return oldMouseDown?.apply(this, arguments);
  };

  const oldMenu = nodeType.prototype.getExtraMenuOptions;
  nodeType.prototype.getExtraMenuOptions = function (_, options) {
    const result = oldMenu?.apply(this, arguments);
    const links = linksOf(this);
    if (!links.length) return result;

    options ||= arguments[1];
    if (!Array.isArray(options)) return result;

    const node = this;
    const submenu = links.map((link, index) => ({
      content: `${index + 1}. ${sourceLabel(node, link, index)}`,
      callback: () => removeOne(node, index),
    }));
    submenu.push(null);
    submenu.push({
      content: text("清空全部参考", "Clear all references"),
      callback: () => clearLinks(node),
    });

    options.unshift({
      content: `${text("移除参考", "Remove references")} (${links.length})`,
      has_submenu: true,
      submenu: { options: submenu },
    });
    options.unshift(null);
    return result;
  };
}

app.registerExtension({
  name: "TerryToolbox.H3VirtualMediaDisconnect",
  beforeRegisterNodeDef(nodeType, nodeData) {
    installNode(nodeType, nodeData);
  },
});
