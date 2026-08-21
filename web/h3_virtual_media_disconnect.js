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
  if (!prop) return false;
  node.properties ||= {};
  node.properties[prop] = Array.isArray(next) ? next : [];
  refreshNode(node);
  node.graph?.change?.();
  app.graph?.change?.();
  return true;
}

function clearLinks(node) {
  if (!linksOf(node).length) return false;
  return setLinks(node, []);
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

function singleRemoveSubmenu(node) {
  return linksOf(node).map((link, index) => ({
    content: `${index + 1}. ${sourceLabel(node, link, index)}`,
    callback: () => removeOne(node, index),
  }));
}

function installNode(nodeType, nodeData) {
  if (!TARGETS[nodeData?.name] || nodeType.prototype.__terryRemoveReferenceInputsMenu) return;
  nodeType.prototype.__terryRemoveReferenceInputsMenu = true;

  const oldMenu = nodeType.prototype.getExtraMenuOptions;
  nodeType.prototype.getExtraMenuOptions = function (_, options) {
    const result = oldMenu?.apply(this, arguments);
    const links = linksOf(this);
    if (!links.length || !Array.isArray(options)) return result;

    const node = this;
    const removeAll = {
      content: text("✂️ 移除所有参考输入", "✂️ Remove all reference inputs"),
      callback: () => clearLinks(node),
    };
    const removeOneMenu = {
      content: text("移除单个参考输入", "Remove a reference input"),
      has_submenu: true,
      submenu: { options: singleRemoveSubmenu(node) },
    };

    // Keep both actions at the same context-menu level, with the per-reference submenu directly below Remove All.
    options.unshift(null, removeAll, removeOneMenu);
    return result;
  };
}

app.registerExtension({
  name: "TerryToolbox.H3VirtualMediaDisconnect",
  beforeRegisterNodeDef(nodeType, nodeData) {
    installNode(nodeType, nodeData);
  },
});
