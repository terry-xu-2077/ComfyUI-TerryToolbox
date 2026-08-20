import { app } from "../../scripts/app.js";

const NODE_ID = "TerryH3ShotTimeline";

function isTarget(node) {
  return [node?.comfyClass, node?.type, node?.constructor?.type, node?.constructor?.nodeData?.name]
    .some((value) => String(value || "") === NODE_ID);
}

function localeIsZh() {
  try {
    const raw = app?.ui?.settings?.getSettingValue?.("Comfy.Locale");
    const locale = String(raw || navigator.language || "en").toLowerCase().replace("_", "-");
    return locale === "zh" || locale.startsWith("zh-");
  } catch {
    return false;
  }
}

function localizeRoot(root) {
  if (!root?.querySelectorAll) return;
  const zh = localeIsZh();
  for (const option of root.querySelectorAll(".terry-tl-option")) {
    const text = option.querySelector("span");
    if (!text) continue;
    const raw = String(text.dataset.terryRawLabel || text.textContent || "").trim();
    if (!text.dataset.terryRawLabel) text.dataset.terryRawLabel = raw;

    let nextText = null;
    let nextTitle = null;
    if (raw === "overall_soundscape") {
      nextText = zh ? "整体声音环境" : "overall_soundscape";
      nextTitle = zh ? "对应 H3 字段 overall_soundscape；仅改变界面显示名称，不改变输出格式。" : "H3 field: overall_soundscape";
    } else if (raw === "non_diegetic_music") {
      nextText = zh ? "非剧情内音乐" : "non_diegetic_music";
      nextTitle = zh ? "对应 H3 字段 non_diegetic_music；仅改变界面显示名称，不改变输出格式。" : "H3 field: non_diegetic_music";
    }

    // Avoid producing DOM mutations when nothing actually changes.
    if (nextText != null && text.textContent !== nextText) text.textContent = nextText;
    if (nextTitle != null && option.title !== nextTitle) option.title = nextTitle;
  }
}

function installSoon(node) {
  if (!isTarget(node)) return;
  // Only touch this node's own DOM. A document-wide MutationObserver was too
  // expensive in ComfyUI because the canvas/UI continuously mutates DOM.
  for (const delay of [0, 120, 400]) {
    setTimeout(() => localizeRoot(node.__terryH3ShotTimeline?.root), delay);
  }
}

app.registerExtension({
  name: "TerryToolbox.H3TimelineAudioLabelsI18n",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_ID || nodeType.prototype.__terryTimelineAudioLabelsI18n) return;
    nodeType.prototype.__terryTimelineAudioLabelsI18n = true;

    const created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function() {
      const result = created?.apply(this, arguments);
      installSoon(this);
      return result;
    };

    const configure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function() {
      const result = configure?.apply(this, arguments);
      installSoon(this);
      return result;
    };
  },
  loadedGraphNode(node) {
    installSoon(node);
  },
});
