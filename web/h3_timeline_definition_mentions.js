import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_ID = "TerryH3ShotTimeline";
const LINKS_PROP = "terry_h3_timeline_virtual_media_links";

function isTarget(node) {
  return [node?.comfyClass, node?.type, node?.constructor?.type, node?.constructor?.nodeData?.name]
    .some((value) => String(value || "") === NODE_ID);
}

function localeIsZh() {
  try {
    const raw = app?.ui?.settings?.getSettingValue?.("Comfy.Locale");
    const locale = String(raw || navigator.language || "en").toLowerCase().replace("_", "-");
    return locale === "zh" || locale.startsWith("zh-");
  } catch { return false; }
}

function t(zh, en) { return localeIsZh() ? zh : en; }

function serializeRich(editor) {
  let out = "";
  for (const child of editor?.childNodes || []) {
    out += child.nodeType === Node.TEXT_NODE
      ? child.nodeValue
      : (child.dataset?.raw ?? child.innerText ?? "");
  }
  return out.replace(/\u200B/g, "");
}

function cleanDescription(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/^[-–—:：\s]+/, "")
    .trim();
}

function parseDefinitions(globalRaw) {
  const source = String(globalRaw || "").replace(/\r\n?/g, "\n");
  const definitions = new Map();
  const direct = [];

  // A definition starts with an H3 asset token and runs until the next
  // definition or major H3 section. This mirrors the official
  // subject_definitions style while still tolerating users omitting the header.
  const re = /<(Subject|Picture|Video|Audio)\s+(\d+)>\s*(?:is\b|[:：-])?\s*([\s\S]*?)(?=\n\s*<(?:Subject|Picture|Video|Audio)\s+\d+>\s*(?:is\b|[:：-])?|\n\s*(?:summary|retention_analysis|detailed_description|overall_soundscape|non_diegetic_music)\s*:|$)/gi;

  for (const match of source.matchAll(re)) {
    const type = match[1][0].toUpperCase() + match[1].slice(1).toLowerCase();
    const index = Number(match[2]);
    const raw = `<${type} ${index}>`;
    const description = cleanDescription(match[3]);
    const entry = { raw, type, index, description, direct: true };
    definitions.set(raw.toLowerCase(), entry);
    direct.push(entry);
  }

  // Media tokens referenced inside a Subject/Audio definition count as defined
  // for the shot picker too. Their menu description is inherited from the
  // definition that explains their role.
  for (const owner of direct) {
    for (const ref of owner.description.matchAll(/<(Picture|Video|Audio)\s+(\d+)>/gi)) {
      const type = ref[1][0].toUpperCase() + ref[1].slice(1).toLowerCase();
      const index = Number(ref[2]);
      const raw = `<${type} ${index}>`;
      const key = raw.toLowerCase();
      if (definitions.has(key)) continue;
      definitions.set(key, {
        raw,
        type,
        index,
        description: t(
          `用于 ${owner.raw}：${owner.description}`,
          `Used by ${owner.raw}: ${owner.description}`,
        ),
        direct: false,
        owner: owner.raw,
      });
    }
  }

  return definitions;
}

function graphNodeById(node, id) {
  return (node?.graph || app.graph)?.getNodeById?.(Number(id)) || null;
}

function sourceKind(source, slot = 0, fallback = "") {
  const raw = String(source?.outputs?.[slot]?.type || fallback || "").toUpperCase();
  if (raw.includes("VIDEO")) return "video";
  if (raw.includes("AUDIO")) return "audio";
  return "picture";
}

function filenameFromSource(source, kind) {
  const preferred = kind === "picture"
    ? ["image", "filename", "file"]
    : kind === "video"
      ? ["video", "file", "filename"]
      : ["audio", "file", "filename"];
  for (const widget of source?.widgets || []) {
    const value = widget?.value;
    const filename = typeof value === "object" ? (value?.filename || value?.name) : value;
    if (!filename || /^(data:|blob:|https?:)/i.test(String(filename))) continue;
    if (preferred.includes(String(widget?.name || "").toLowerCase()) || /\.(png|jpe?g|webp|gif|mp4|webm|mov|mp3|wav|flac|ogg|m4a)$/i.test(String(filename))) {
      return String(filename);
    }
  }
  return "";
}

function previewFromSource(source, kind) {
  if (!source || kind === "audio") return "";
  const filename = filenameFromSource(source, kind);
  if (filename) {
    const widget = (source.widgets || []).find((item) => {
      const value = item?.value;
      return String(typeof value === "object" ? (value?.filename || value?.name || "") : (value || "")) === filename;
    });
    const value = widget?.value;
    const query = new URLSearchParams({
      filename,
      type: typeof value === "object" ? String(value.type || "input") : "input",
    });
    if (typeof value === "object" && value.subfolder) query.set("subfolder", String(value.subfolder));
    return api.apiURL(`/view?${query.toString()}`);
  }
  return (source.imgs || []).find((item) => item?.src)?.src || "";
}

function connectedMedia(node) {
  const counts = { picture: 0, video: 0, audio: 0 };
  const out = [];
  const seen = new Set();
  for (const link of node?.properties?.[LINKS_PROP] || []) {
    const sourceId = Number(link?.source_id);
    const slot = Number(link?.source_slot) || 0;
    const source = graphNodeById(node, sourceId);
    if (!source || !Number.isFinite(sourceId)) continue;
    const key = `${sourceId}:${slot}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const kind = link.kind || sourceKind(source, slot, link.source_type);
    counts[kind] = (counts[kind] || 0) + 1;
    const index = counts[kind];
    const type = kind === "picture" ? "Picture" : kind === "video" ? "Video" : "Audio";
    const raw = `<${type} ${index}>`;
    out.push({
      raw,
      type,
      kind,
      index,
      label: `${type} ${index}`,
      source: filenameFromSource(source, kind).split(/[\\/]/).pop() || source.title || `${type} ${index}`,
      preview: previewFromSource(source, kind),
    });
  }
  return out;
}

function shotMentionOptions(node, root) {
  const globalEditor = root?.querySelector?.(".terry-tl-section .terry-tl-rich");
  const definitions = parseDefinitions(serializeRich(globalEditor));
  const media = connectedMedia(node);
  const result = [];
  const used = new Set();

  // Official H3 Subject definitions are the most useful things inside a Shot,
  // so they come first even though Subject is not a physical connector.
  const subjects = [...definitions.values()]
    .filter((item) => item.type.toLowerCase() === "subject")
    .sort((a, b) => a.index - b.index);
  for (const item of subjects) {
    result.push({
      raw: item.raw,
      label: item.raw.slice(1, -1),
      kind: "subject",
      defined: true,
      description: item.description || t("已在全局描述中定义", "Defined in Global description"),
      source: "",
      preview: "",
    });
    used.add(item.raw.toLowerCase());
  }

  // Then connected Picture / Video / Audio that the global definitions already
  // explain. If a media token is referenced by a Subject definition, inherit
  // that Subject's definition as its explanation.
  for (const item of media) {
    const definition = definitions.get(item.raw.toLowerCase());
    if (!definition) continue;
    result.push({
      ...item,
      defined: true,
      description: definition.description || t("已在全局描述中定义", "Defined in Global description"),
    });
    used.add(item.raw.toLowerCase());
  }

  // Finally keep every connected asset usable, but make the missing definition
  // explicit so users can deliberately use raw media references when needed.
  for (const item of media) {
    if (used.has(item.raw.toLowerCase())) continue;
    result.push({
      ...item,
      defined: false,
      description: t("⚠ 此资产未定义，但仍可直接使用", "⚠ This asset is not defined, but can still be used"),
    });
  }

  return result;
}

function makeToken(option) {
  const chip = document.createElement("span");
  chip.className = `terry-tl-chip is-${option.kind}`;
  chip.contentEditable = "false";
  chip.dataset.raw = option.raw;
  if (option.preview && option.kind !== "audio") {
    const image = document.createElement("img");
    image.src = option.preview;
    image.alt = "";
    chip.append(image);
  }
  chip.append(document.createTextNode(option.label));
  return chip;
}

function insertAtCaret(editor, nodeToInsert) {
  const selection = window.getSelection?.();
  if (!selection?.rangeCount || !editor.contains(selection.anchorNode)) {
    editor.append(nodeToInsert);
  } else {
    const range = selection.getRangeAt(0);
    range.deleteContents();
    range.insertNode(nodeToInsert);
    range.setStartAfter(nodeToInsert);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }
  editor.dispatchEvent(new InputEvent("input", {
    bubbles: true,
    inputType: "insertText",
    data: null,
  }));
}

function closeDefinitionMenus() {
  for (const menu of document.querySelectorAll(".terry-tl-definition-mention")) menu.remove();
}

function openDefinitionMenu(node, root, editor) {
  closeDefinitionMenus();
  const options = shotMentionOptions(node, root);
  if (!options.length) return;

  const menu = document.createElement("div");
  menu.className = "terry-tl-mention terry-tl-definition-mention";

  const definedCount = options.filter((item) => item.defined).length;
  const head = document.createElement("div");
  head.className = "terry-tl-definition-head";
  head.textContent = definedCount
    ? t(`已定义 ${definedCount} · 未定义资产仍可使用`, `${definedCount} defined · undefined assets remain usable`)
    : t("暂无已定义资产 · 可直接使用连接资产", "No defined assets yet · connected assets remain usable");
  menu.append(head);

  for (const option of options) {
    const button = document.createElement("button");
    button.type = "button";
    button.classList.toggle("is-undefined", !option.defined);

    const visual = document.createElement("span");
    visual.className = "terry-tl-definition-visual";
    if (option.preview && option.kind !== "audio") {
      const image = document.createElement("img");
      image.src = option.preview;
      image.alt = "";
      visual.append(image);
    } else {
      visual.textContent = option.kind === "subject" ? "S" : option.kind === "audio" ? "♪" : option.kind === "video" ? "▶" : "▣";
    }

    const text = document.createElement("span");
    const title = document.createElement("b");
    title.textContent = option.label;
    const description = document.createElement("small");
    description.className = "terry-tl-definition-description";
    description.textContent = option.description;
    text.append(title, description);
    if (option.source) {
      const source = document.createElement("em");
      source.textContent = option.source;
      text.append(source);
    }

    button.append(visual, text);
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      insertAtCaret(editor, makeToken(option));
      menu.remove();
      editor.focus({ preventScroll: true });
    });
    menu.append(button);
  }

  document.body.append(menu);
  const rect = editor.getBoundingClientRect();
  const width = 330;
  menu.style.width = `${width}px`;
  menu.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(rect.bottom + 4, innerHeight - Math.min(330, menu.offsetHeight || 280) - 8))}px`;
}

function findTimelineNode(root) {
  for (const node of app.graph?._nodes || []) {
    if (!isTarget(node)) continue;
    if (node.__terryH3ShotTimeline?.root === root) return node;
  }
  return null;
}

function installStyle() {
  if (document.getElementById("terry-h3-timeline-definition-mentions-style")) return;
  const style = document.createElement("style");
  style.id = "terry-h3-timeline-definition-mentions-style";
  style.textContent = `
.terry-tl-definition-mention{max-height:320px!important}
.terry-tl-definition-head{padding:6px 7px 7px;border-bottom:1px solid rgba(255,255,255,.08);font:10px/1.3 system-ui,sans-serif;opacity:.58}
.terry-tl-definition-mention button{grid-template-columns:40px minmax(0,1fr)!important;align-items:start!important;min-height:52px!important}
.terry-tl-definition-mention button.is-undefined{opacity:.68}
.terry-tl-definition-visual{display:grid;place-items:center;width:36px;height:36px;border-radius:4px;background:rgba(255,255,255,.065);font:600 11px/1 system-ui,sans-serif;overflow:hidden}
.terry-tl-definition-visual img{width:36px!important;height:36px!important;object-fit:cover}
.terry-tl-definition-mention .terry-tl-definition-description{display:-webkit-box!important;margin-top:3px!important;overflow:hidden!important;white-space:normal!important;line-height:1.3!important;-webkit-line-clamp:2;-webkit-box-orient:vertical;text-overflow:ellipsis}
.terry-tl-definition-mention em{display:block;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:9px/1.2 system-ui,sans-serif;font-style:normal;opacity:.36}
`;
  document.head.append(style);
}

app.registerExtension({
  name: "TerryToolbox.H3TimelineDefinitionMentions",
  setup() {
    installStyle();

    // Capture before the timeline editor's own @ handler. Only Shot editors are
    // overridden; Global description keeps its existing raw-media picker so it
    // remains convenient for writing definitions.
    document.addEventListener("beforeinput", (event) => {
      if (event.inputType !== "insertText" || event.data !== "@") return;
      const editor = event.target?.closest?.(".terry-tl-card .terry-tl-rich");
      if (!editor) return;
      const root = editor.closest(".terry-h3-timeline-root");
      const node = findTimelineNode(root);
      if (!node) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      openDefinitionMenu(node, root, editor);
    }, true);

    document.addEventListener("pointerdown", (event) => {
      if (!event.target.closest?.(".terry-tl-definition-mention")) closeDefinitionMenus();
    }, true);
  },
});
