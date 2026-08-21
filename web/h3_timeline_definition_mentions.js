import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_ID = "TerryH3ShotTimeline";
const LINKS_PROP = "terry_h3_timeline_virtual_media_links";
const BINDINGS_PROP = "terry_h3_timeline_subject_bindings";

function isTarget(node) {
  return [node?.comfyClass, node?.type, node?.constructor?.type, node?.constructor?.comfyClass, node?.constructor?.nodeData?.name]
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
    out += child.nodeType === Node.TEXT_NODE ? child.nodeValue : (child.dataset?.raw ?? child.innerText ?? "");
  }
  return out.replace(/\u200B/g, "");
}

function cleanDescription(text) {
  return String(text || "").replace(/\s+/g, " ").replace(/^[-–—:：\s]+/, "").trim();
}

function parseDefinitions(globalRaw) {
  const source = String(globalRaw || "").replace(/\r\n?/g, "\n");
  const definitions = new Map();
  const direct = [];
  const re = /<(Subject|Picture|Video|Audio)\s+(\d+)>\s*(?:is\b|[:：-])?\s*([\s\S]*?)(?=\n\s*<(?:Subject|Picture|Video|Audio)\s+\d+>\s*(?:is\b|[:：-])?|\n\s*(?:summary|retention_analysis|detailed_description|overall_soundscape|non_diegetic_music)\s*:|$)/gi;
  for (const match of source.matchAll(re)) {
    const type = match[1][0].toUpperCase() + match[1].slice(1).toLowerCase();
    const index = Number(match[2]);
    const raw = `<${type} ${index}>`;
    const entry = { raw, type, index, description: cleanDescription(match[3]), direct: true };
    definitions.set(raw.toLowerCase(), entry);
    direct.push(entry);
  }
  for (const owner of direct) {
    for (const ref of owner.description.matchAll(/<(Picture|Video|Audio)\s+(\d+)>/gi)) {
      const type = ref[1][0].toUpperCase() + ref[1].slice(1).toLowerCase();
      const index = Number(ref[2]);
      const raw = `<${type} ${index}>`;
      if (!definitions.has(raw.toLowerCase())) {
        definitions.set(raw.toLowerCase(), {
          raw, type, index, direct: false, owner: owner.raw,
          description: t(`用于 ${owner.raw}：${owner.description}`, `Used by ${owner.raw}: ${owner.description}`),
        });
      }
    }
  }
  return definitions;
}

function graphNode(node, id) { return (node?.graph || app.graph)?.getNodeById?.(Number(id)) || null; }
function sourceKind(source, slot = 0, fallback = "") {
  const raw = String(source?.outputs?.[slot]?.type || fallback || "").toUpperCase();
  if (raw.includes("VIDEO")) return "video";
  if (raw.includes("AUDIO")) return "audio";
  return "picture";
}
function filename(source, kind) {
  const preferred = kind === "picture" ? ["image", "filename", "file"] : kind === "video" ? ["video", "file", "filename"] : ["audio", "file", "filename"];
  for (const w of source?.widgets || []) {
    const v = w?.value;
    const f = typeof v === "object" ? (v?.filename || v?.name) : v;
    if (!f || /^(data:|blob:|https?:)/i.test(String(f))) continue;
    if (preferred.includes(String(w?.name || "").toLowerCase()) || /\.(png|jpe?g|webp|gif|mp4|webm|mov|mp3|wav|flac|ogg|m4a)$/i.test(String(f))) return String(f);
  }
  return "";
}
function preview(source, kind) {
  if (!source || kind === "audio") return "";
  const file = filename(source, kind);
  if (file) {
    const w = (source.widgets || []).find((item) => {
      const v = item?.value;
      return String(typeof v === "object" ? (v?.filename || v?.name || "") : (v || "")) === file;
    });
    const v = w?.value;
    const q = new URLSearchParams({ filename: file, type: typeof v === "object" ? String(v.type || "input") : "input" });
    if (typeof v === "object" && v.subfolder) q.set("subfolder", String(v.subfolder));
    return api.apiURL(`/view?${q.toString()}`);
  }
  return (source.imgs || []).find((item) => item?.src)?.src || "";
}

function connectedMedia(node) {
  const counts = { picture: 0, video: 0, audio: 0 };
  const out = [];
  const seen = new Set();
  for (const link of node?.properties?.[LINKS_PROP] || []) {
    const sourceId = Number(link?.source_id), slot = Number(link?.source_slot) || 0;
    const source = graphNode(node, sourceId);
    if (!source || !Number.isFinite(sourceId)) continue;
    const key = `${sourceId}:${slot}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const kind = link.kind || sourceKind(source, slot, link.source_type);
    counts[kind] = (counts[kind] || 0) + 1;
    const index = counts[kind];
    const type = kind === "picture" ? "Picture" : kind === "video" ? "Video" : "Audio";
    out.push({ key, raw: `<${type} ${index}>`, type, kind, index, label: `${type} ${index}`,
      source: filename(source, kind).split(/[\\/]/).pop() || source.title || `${type} ${index}`,
      preview: preview(source, kind) });
  }
  return out;
}

function subjectBindings(node) {
  const raw = node?.properties?.[BINDINGS_PROP];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw;
}

function boundSubjectsForAsset(node, assetKey) {
  const list = subjectBindings(node)[assetKey];
  return Array.isArray(list) ? list.map(Number).filter(Number.isFinite) : [];
}

function shotMentionOptions(node, root) {
  const globalEditor = root?.querySelector?.(".terry-tl-section .terry-tl-rich");
  const definitions = parseDefinitions(serializeRich(globalEditor));
  const media = connectedMedia(node);
  const result = [];
  const used = new Set();

  const subjects = [...definitions.values()].filter((x) => x.type.toLowerCase() === "subject").sort((a, b) => a.index - b.index);
  for (const item of subjects) {
    const bound = media.find((asset) => boundSubjectsForAsset(node, asset.key).includes(item.index));
    result.push({ raw: item.raw, label: item.raw.slice(1, -1), kind: "subject", defined: true,
      description: item.description || t("已在全局描述中定义", "Defined in Global description"),
      source: bound?.source || "", preview: bound?.preview || "" });
    used.add(item.raw.toLowerCase());
  }

  for (const item of media) {
    const definition = definitions.get(item.raw.toLowerCase());
    const boundSubjects = boundSubjectsForAsset(node, item.key);
    const boundDefinition = boundSubjects.map((n) => definitions.get(`<subject ${n}>`)).find(Boolean);
    if (!definition && !boundDefinition) continue;
    const owner = boundSubjects.length ? `<Subject ${boundSubjects[0]}>` : "";
    result.push({ ...item, defined: true,
      description: definition?.description || boundDefinition?.description || t(`已绑定到 ${owner}`, `Bound to ${owner}`) });
    used.add(item.raw.toLowerCase());
  }

  for (const item of media) {
    if (used.has(item.raw.toLowerCase())) continue;
    result.push({ ...item, defined: false,
      description: t("⚠ 此资产尚未在全局描述中定义或绑定", "⚠ This asset is not defined or bound in Global description") });
  }
  return result;
}

function makeToken(option) {
  const chip = document.createElement("span");
  chip.className = `terry-tl-chip is-${option.kind}`;
  chip.contentEditable = "false";
  chip.dataset.raw = option.raw;
  if (option.preview && option.kind !== "audio") {
    const image = document.createElement("img"); image.src = option.preview; image.alt = ""; chip.append(image);
  }
  chip.append(document.createTextNode(option.label));
  return chip;
}

function insertAtCaret(editor, nodeToInsert) {
  const selection = window.getSelection?.();
  if (!selection?.rangeCount || !editor.contains(selection.anchorNode)) editor.append(nodeToInsert);
  else {
    const range = selection.getRangeAt(0); range.deleteContents(); range.insertNode(nodeToInsert);
    range.setStartAfter(nodeToInsert); range.collapse(true); selection.removeAllRanges(); selection.addRange(range);
  }
  editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: null }));
}
function closeMenus() { for (const menu of document.querySelectorAll(".terry-tl-definition-mention")) menu.remove(); }

function openMenu(node, root, editor) {
  closeMenus();
  const options = shotMentionOptions(node, root);
  if (!options.length) return;
  const menu = document.createElement("div"); menu.className = "terry-tl-mention terry-tl-definition-mention";
  const count = options.filter((x) => x.defined).length;
  const head = document.createElement("div"); head.className = "terry-tl-definition-head";
  head.textContent = count ? t(`已定义/绑定 ${count} 项`, `${count} defined/bound`) : t("暂无已定义或绑定资产", "No defined or bound assets yet");
  menu.append(head);
  for (const option of options) {
    const button = document.createElement("button"); button.type = "button"; button.classList.toggle("is-undefined", !option.defined);
    const visual = document.createElement("span"); visual.className = "terry-tl-definition-visual";
    if (option.preview && option.kind !== "audio") { const image = document.createElement("img"); image.src = option.preview; image.alt = ""; visual.append(image); }
    else visual.textContent = option.kind === "subject" ? "S" : option.kind === "audio" ? "♪" : option.kind === "video" ? "▶" : "▣";
    const text = document.createElement("span"); const title = document.createElement("b"); title.textContent = option.label;
    const desc = document.createElement("small"); desc.className = "terry-tl-definition-description"; desc.textContent = option.description;
    text.append(title, desc);
    if (option.source) { const source = document.createElement("em"); source.textContent = option.source; text.append(source); }
    button.append(visual, text);
    button.addEventListener("pointerdown", (event) => { event.preventDefault(); event.stopPropagation(); insertAtCaret(editor, makeToken(option)); menu.remove(); editor.focus({ preventScroll: true }); });
    menu.append(button);
  }
  document.body.append(menu);
  const rect = editor.getBoundingClientRect(), width = 330;
  menu.style.width = `${width}px`;
  menu.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(rect.bottom + 4, innerHeight - Math.min(330, menu.offsetHeight || 280) - 8))}px`;
}

function findTimelineNode(root) {
  return (app.graph?._nodes || []).find((node) => isTarget(node) && node.__terryH3ShotTimeline?.root === root) || null;
}

function installStyle() {
  if (document.getElementById("terry-h3-timeline-definition-mentions-style")) return;
  const style = document.createElement("style"); style.id = "terry-h3-timeline-definition-mentions-style";
  style.textContent = `
.terry-tl-definition-mention{max-height:320px!important}.terry-tl-definition-head{padding:6px 7px 7px;border-bottom:1px solid rgba(255,255,255,.08);font:10px/1.3 system-ui,sans-serif;opacity:.65}
.terry-tl-definition-mention button{grid-template-columns:40px minmax(0,1fr)!important;align-items:start!important;min-height:52px!important}.terry-tl-definition-mention button.is-undefined{opacity:.55}
.terry-tl-definition-visual{display:grid;place-items:center;width:36px;height:36px;border-radius:4px;background:rgba(255,255,255,.065);font:600 11px/1 system-ui,sans-serif;overflow:hidden}.terry-tl-definition-visual img{width:36px!important;height:36px!important;object-fit:cover}
.terry-tl-definition-description{display:-webkit-box!important;margin-top:3px!important;overflow:hidden!important;white-space:normal!important;line-height:1.3!important;-webkit-line-clamp:2;-webkit-box-orient:vertical}.terry-tl-definition-mention em{display:block;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:9px/1.2 system-ui,sans-serif;font-style:normal;opacity:.4}
`;
  document.head.append(style);
}

app.registerExtension({
  name: "TerryToolbox.H3TimelineDefinitionMentions",
  setup() {
    installStyle();
    document.addEventListener("beforeinput", (event) => {
      if (event.inputType !== "insertText" || event.data !== "@") return;
      const editor = event.target?.closest?.(".terry-tl-card .terry-tl-rich");
      if (!editor) return;
      const root = editor.closest(".terry-h3-timeline-root"), node = findTimelineNode(root);
      if (!node) return;
      event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation?.();
      openMenu(node, root, editor);
    }, true);
    document.addEventListener("pointerdown", (event) => { if (!event.target?.closest?.(".terry-tl-definition-mention")) closeMenus(); }, true);
  },
});
