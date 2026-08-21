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

function clearLinks(node) {
  const prop = propFor(node);
  if (!prop || !linksOf(node).length) return false;
  node.properties[prop] = [];
  refreshNode(node);
  node.graph?.change?.();
  app.graph?.change?.();
  return true;
}

function installNode(nodeType, nodeData) {
  if (!TARGETS[nodeData?.name] || nodeType.prototype.__terryRemoveAllReferenceInputs) return;
  nodeType.prototype.__terryRemoveAllReferenceInputs = true;

  const oldMenu = nodeType.prototype.getExtraMenuOptions;
  nodeType.prototype.getExtraMenuOptions = function (_, options) {
    const result = oldMenu?.apply(this, arguments);
    if (!linksOf(this).length || !Array.isArray(options)) return result;

    const node = this;
    options.unshift({
      content: text("✂️ 移除所有参考输入", "✂️ Remove all reference inputs"),
      callback: () => clearLinks(node),
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
