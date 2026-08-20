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
    if (raw === "overall_soundscape") {
      text.textContent = zh ? "整体声音环境" : "overall_soundscape";
      option.title = zh ? "对应 H3 字段 overall_soundscape；仅改变界面显示名称，不改变输出格式。" : "H3 field: overall_soundscape";
    } else if (raw === "non_diegetic_music") {
      text.textContent = zh ? "非剧情内音乐" : "non_diegetic_music";
      option.title = zh ? "对应 H3 字段 non_diegetic_music；仅改变界面显示名称，不改变输出格式。" : "H3 field: non_diegetic_music";
    }
  }
}

function installSoon(node) {
  if (!isTarget(node)) return;
  for (const delay of [0, 60, 180, 500]) {
    setTimeout(() => localizeRoot(node.__terryH3ShotTimeline?.root), delay);
  }
}

app.registerExtension({
  name: "TerryToolbox.H3TimelineAudioLabelsI18n",
  setup() {
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const added of record.addedNodes || []) {
          if (added?.nodeType !== Node.ELEMENT_NODE) continue;
          if (added.matches?.(".terry-h3-timeline-root")) localizeRoot(added);
          for (const root of added.querySelectorAll?.(".terry-h3-timeline-root") || []) localizeRoot(root);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  },
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_ID || nodeType.prototype.__terryTimelineAudioLabelsI18n) return;
    nodeType.prototype.__terryTimelineAudioLabelsI18n = true;
    for (const hook of ["onNodeCreated", "onAdded", "onConfigure"]) {
      const old = nodeType.prototype[hook];
      nodeType.prototype[hook] = function() {
        const result = old?.apply(this, arguments);
        installSoon(this);
        return result;
      };
    }
  },
  loadedGraphNode(node) {
    installSoon(node);
  },
});
