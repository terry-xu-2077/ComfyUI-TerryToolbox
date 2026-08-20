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
function graphNode(node, id) { return (node?.graph || app.graph)?.getNodeById?.(Number(id)) || null; }

function sourceKind(source, slot = 0, fallback = "") {
  const raw = String(source?.outputs?.[slot]?.type || fallback || "").toUpperCase();
  if (raw.includes("VIDEO")) return "video";
  if (raw.includes("AUDIO")) return "audio";
  return "picture";
}

function filename(source, kind) {
  const preferred = kind === "picture" ? ["image", "filename", "file"]
    : kind === "video" ? ["video", "file", "filename", "video_file", "videofile"]
    : ["audio", "file", "filename", "audio_file", "audiofile"];
  const widgets = Array.isArray(source?.widgets) ? source.widgets : [];
  const ordered = [...widgets.filter((w) => preferred.includes(String(w?.name || "").toLowerCase())), ...widgets];
  for (const w of ordered) {
    const value = w?.value;
    const file = typeof value === "object" ? (value?.filename || value?.name || "") : value;
    if (!file || /^(data:|blob:|https?:)/i.test(String(file))) continue;
    if (preferred.includes(String(w?.name || "").toLowerCase()) || /\.(png|jpe?g|webp|gif|bmp|tiff?|mp4|webm|mov|mkv|avi|m4v|mp3|wav|flac|ogg|m4a|aac)$/i.test(String(file))) return String(file);
  }
  return "";
}

function preview(source, kind) {
  if (!source || kind === "audio") return "";
  const file = filename(source, kind);
  if (file) {
    const w = (source.widgets || []).find((item) => {
      const value = item?.value;
      return String(typeof value === "object" ? (value?.filename || value?.name || "") : (value || "")) === file;
    });
    const value = w?.value;
    const q = new URLSearchParams({ filename: file, type: typeof value === "object" ? String(value.type || "input") : "input" });
    if (typeof value === "object" && value.subfolder) q.set("subfolder", String(value.subfolder));
    return api.apiURL(`/view?${q.toString()}`);
  }
  return (source.imgs || []).find((item) => item?.src)?.src || "";
}

function mediaAssets(node) {
  const counts = { picture: 0, video: 0, audio: 0 };
  const out = [];
  const seen = new Set();
  for (const link of node?.properties?.[LINKS_PROP] || []) {
    const sourceId = Number(link?.source_id);
    const slot = Number(link?.source_slot) || 0;
    const source = graphNode(node, sourceId);
    if (!source || !Number.isFinite(sourceId)) continue;
    const key = `${sourceId}:${slot}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const kind = link.kind || sourceKind(source, slot, link.source_type);
    counts[kind] = (counts[kind] || 0) + 1;
    const index = counts[kind];
    const type = kind === "picture" ? "Picture" : kind === "video" ? "Video" : "Audio";
    out.push({ key, kind, index, tag: `<${type} ${index}>`, label: `${type} ${index}`,
      name: filename(source, kind).split(/[\\/]/).pop() || source.title || `${type} ${index}`,
      preview: preview(source, kind) });
  }
  return out;
}

function bindings(node) {
  node.properties ||= {};
  if (!node.properties[BINDINGS_PROP] || typeof node.properties[BINDINGS_PROP] !== "object" || Array.isArray(node.properties[BINDINGS_PROP])) node.properties[BINDINGS_PROP] = {};
  return node.properties[BINDINGS_PROP];
}

function subjectNumber(chip) {
  const m = String(chip?.dataset?.raw || "").match(/^<Subject\s+(\d+)>$/i);
  return m ? Number(m[1]) : null;
}
function parseMediaChip(chip) {
  const m = String(chip?.dataset?.raw || "").match(/^<(Picture|Video|Audio)\s+(\d+)>$/i);
  return m ? { type: m[1].toLowerCase(), number: Number(m[2]) } : null;
}

function serializeGlobal(root) {
  const editor = root?.querySelector?.(".terry-tl-section .terry-tl-rich");
  let raw = "";
  for (const child of editor?.childNodes || []) raw += child.nodeType === Node.TEXT_NODE ? child.nodeValue : (child.dataset?.raw ?? child.innerText ?? "");
  return raw;
}

function autoBindFromGlobal(node, root, number, assets) {
  if (bindings(node)[String(number)]) return;
  const raw = serializeGlobal(root);
  const marker = new RegExp(`<Subject\\s+${number}>\\s*(?:is\\b|[:：-])?\\s*([\\s\\S]*?)(?=\\n\\s*<Subject\\s+\\d+>|$)`, "i");
  const def = raw.match(marker)?.[1] || "";
  const ref = def.match(/<(Picture|Video)\s+(\d+)>/i);
  if (!ref) return;
  const kind = ref[1].toLowerCase() === "picture" ? "picture" : "video";
  const asset = assets.find((item) => item.kind === kind && item.index === Number(ref[2]));
  if (asset) bindings(node)[String(number)] = asset.key;
}

function decorateSubject(node, root, chip, assets) {
  const number = subjectNumber(chip);
  if (!number) return;
  autoBindFromGlobal(node, root, number, assets);
  const key = bindings(node)[String(number)] || "";
  const asset = assets.find((item) => item.key === key) || null;
  const signature = `${number}|${asset?.key || "none"}|${asset?.preview || ""}`;

  chip.classList.add("terry-h3-chip", "terry-h3-subject-asset-chip", "terry-h3-strong", "terry-h3-type-subject");
  chip.classList.remove("is-subject");
  if (chip.dataset.terryDecorated === signature) return;
  chip.dataset.terryDecorated = signature;

  chip.replaceChildren();
  if (asset?.preview) {
    const img = document.createElement("img"); img.src = asset.preview; img.alt = ""; img.draggable = false; chip.append(img);
  } else {
    const icon = document.createElement("span"); icon.className = "terry-h3-media-icon"; icon.textContent = "◇"; chip.append(icon);
  }
  const label = document.createElement("span"); label.textContent = `Subject ${number}`; chip.append(label);
  chip.title = asset
    ? t(`Subject ${number} · 来源 ${asset.name} · 点击切换来源资产`, `Subject ${number} · source ${asset.name} · click to change source`)
    : t(`Subject ${number} · 尚未绑定来源 · 点击选择图片/视频`, `Subject ${number} · no source bound · click to choose image/video`);
}

function decorateMedia(chip) {
  const info = parseMediaChip(chip);
  if (!info) return;
  chip.classList.add("terry-h3-chip", "terry-h3-media-chip", `terry-h3-type-${info.type}`);
  chip.classList.remove(`is-${info.type}`);
}

function decorateRoot(node, root) {
  if (!root?.isConnected && !root) return;
  const assets = mediaAssets(node);
  for (const chip of root?.querySelectorAll?.(".terry-tl-chip") || []) {
    if (subjectNumber(chip)) decorateSubject(node, root, chip, assets);
    else decorateMedia(chip);
  }
}

function closeMenu(node) {
  node.__terryTimelineRebindMenu?.remove?.();
  node.__terryTimelineRebindMenu = null;
}

function renderAssetItem(asset, onPick) {
  const item = document.createElement("button"); item.type = "button"; item.className = "terry-h3-rebind-item";
  const thumb = document.createElement("span"); thumb.className = "terry-h3-rebind-thumb";
  if (asset.preview && asset.kind !== "audio") { const img = document.createElement("img"); img.src = asset.preview; img.alt = ""; thumb.append(img); }
  else thumb.textContent = asset.kind === "audio" ? "♪" : asset.kind === "video" ? "▶" : "▧";
  const text = document.createElement("span"); const main = document.createElement("b"); main.textContent = asset.label;
  const sub = document.createElement("small"); sub.textContent = asset.name; text.append(main, sub); item.append(thumb, text);
  item.addEventListener("pointerdown", (event) => { event.preventDefault(); event.stopPropagation(); onPick(asset); });
  return item;
}

function positionMenu(menu, chip, width = 300) {
  const rect = chip.getBoundingClientRect();
  let left = Math.max(8, Math.min(rect.left, innerWidth - width - 8));
  let top = rect.bottom + 6;
  const height = Math.min(340, menu.offsetHeight || 260);
  if (top + height > innerHeight - 8) top = Math.max(8, rect.top - height - 6);
  menu.style.left = `${Math.round(left)}px`; menu.style.top = `${Math.round(top)}px`;
}

function openSubjectMenu(node, root, chip, number) {
  closeMenu(node);
  const options = mediaAssets(node).filter((asset) => asset.kind === "picture" || asset.kind === "video");
  const menu = document.createElement("div"); menu.className = "terry-h3-rebind-menu"; node.__terryTimelineRebindMenu = menu;
  const head = document.createElement("div"); head.className = "terry-h3-rebind-head";
  const title = document.createElement("b"); title.textContent = t(`Subject ${number} · 切换来源资产`, `Subject ${number} · Change Source Asset`);
  const hint = document.createElement("small"); hint.textContent = t("仅显示图片 / 视频", "Showing images / videos only"); head.append(title, hint); menu.append(head);
  if (!options.length) { const empty = document.createElement("div"); empty.className = "terry-h3-rebind-empty"; empty.textContent = t("没有可用的兼容资产", "No compatible assets available"); menu.append(empty); }
  for (const asset of options) menu.append(renderAssetItem(asset, (picked) => {
    bindings(node)[String(number)] = picked.key;
    closeMenu(node); decorateRoot(node, root); node.__terryH3ShotTimeline?.save?.(); app.graph?.change?.();
  }));
  document.body.append(menu); positionMenu(menu, chip);
}

function openMediaMenu(node, root, chip, info) {
  closeMenu(node);
  const kind = info.type === "picture" ? "picture" : info.type;
  const options = mediaAssets(node).filter((asset) => asset.kind === kind);
  const menu = document.createElement("div"); menu.className = "terry-h3-rebind-menu"; node.__terryTimelineRebindMenu = menu;
  const head = document.createElement("div"); head.className = "terry-h3-rebind-head";
  const title = document.createElement("b"); title.textContent = t(`${chip.dataset.raw.slice(1, -1)} · 切换资产`, `${chip.dataset.raw.slice(1, -1)} · Change Asset`);
  const hint = document.createElement("small"); hint.textContent = t(`仅显示${kind === "picture" ? "图片" : kind === "video" ? "视频" : "音频"}`, `Showing ${kind}`); head.append(title, hint); menu.append(head);
  for (const asset of options) menu.append(renderAssetItem(asset, (picked) => {
    chip.dataset.raw = picked.tag;
    chip.dataset.terryDecorated = "";
    chip.replaceChildren();
    if (picked.preview && picked.kind !== "audio") { const img = document.createElement("img"); img.src = picked.preview; img.alt = ""; chip.append(img); }
    const label = document.createElement("span"); label.textContent = picked.label; chip.append(label);
    closeMenu(node);
    chip.closest(".terry-tl-rich")?.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: null }));
    decorateRoot(node, root);
  }));
  document.body.append(menu); positionMenu(menu, chip);
}

function installNode(node) {
  if (!isTarget(node)) return false;
  const root = node.__terryH3ShotTimeline?.root;
  if (!root) return false;
  decorateRoot(node, root);
  if (root.__terryTimelineChipRebindBound) return true;
  root.__terryTimelineChipRebindBound = true;

  root.addEventListener("pointerdown", (event) => {
    const chip = event.target?.closest?.(".terry-tl-chip");
    if (!chip || !root.contains(chip)) return;
    const number = subjectNumber(chip); const media = parseMediaChip(chip);
    if (!number && !media) return;
    event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation?.();
    if (number) openSubjectMenu(node, root, chip, number); else openMediaMenu(node, root, chip, media);
  }, true);

  // The old observer called decorateRoot(), which replaced Subject chip children.
  // Those replacements triggered the same observer again, creating an infinite DOM loop
  // during parser restore. Disconnect while decorating and debounce to one frame.
  let raf = 0;
  const observer = new MutationObserver(() => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      observer.disconnect();
      try { decorateRoot(node, root); }
      finally { observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-raw"] }); }
    });
  });
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-raw"] });
  root.__terryTimelineChipObserver = observer;
  return true;
}

function installSoon(node) {
  if (!isTarget(node)) return;
  let attempts = 0;
  const run = () => { attempts += 1; if (installNode(node) || attempts >= 18) return; setTimeout(run, Math.min(900, attempts * 70)); };
  setTimeout(run, 0);
}

function installStyle() {
  if (document.getElementById("terry-h3-timeline-chip-rebind-scroll-style")) return;
  const style = document.createElement("style"); style.id = "terry-h3-timeline-chip-rebind-scroll-style";
  style.textContent = `
.terry-h3-timeline-root{max-height:720px!important;overflow-y:auto!important;overflow-x:hidden!important;scrollbar-gutter:stable;overscroll-behavior:contain;padding-right:5px!important}
.terry-h3-timeline-root::-webkit-scrollbar{width:8px}.terry-h3-timeline-root::-webkit-scrollbar-track{background:rgba(255,255,255,.025);border-radius:8px}.terry-h3-timeline-root::-webkit-scrollbar-thumb{background:rgba(255,255,255,.16);border-radius:8px}.terry-h3-timeline-root::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,.25)}
.terry-h3-timeline-root .terry-h3-chip{margin:1px 2px;vertical-align:middle}.terry-h3-timeline-root .terry-h3-media-chip,.terry-h3-timeline-root .terry-h3-subject-asset-chip{cursor:pointer!important}
.terry-h3-timeline-root .terry-h3-subject-asset-chip img{width:26px;height:26px;object-fit:cover;border-radius:3px}
.terry-h3-timeline-root .terry-h3-media-chip:hover,.terry-h3-timeline-root .terry-h3-subject-asset-chip:hover{box-shadow:inset 0 0 0 1px rgba(0,226,187,.38),0 0 0 1px rgba(0,226,187,.12)!important}`;
  document.head.append(style);
}

app.registerExtension({
  name: "TerryToolbox.H3TimelineChipRebindAndScroll",
  setup() {
    installStyle();
    document.addEventListener("pointerdown", (event) => {
      for (const node of app.graph?._nodes || []) {
        const menu = node?.__terryTimelineRebindMenu;
        if (!menu || menu.contains(event.target) || event.target?.closest?.(".terry-h3-media-chip,.terry-h3-subject-asset-chip")) continue;
        closeMenu(node);
      }
    }, true);
    for (const delay of [0, 120, 400, 1000]) setTimeout(() => {
      for (const node of app.graph?._nodes || []) if (isTarget(node)) installSoon(node);
    }, delay);
  },
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_ID || nodeType.prototype.__terryTimelineChipRebindInstalled) return;
    nodeType.prototype.__terryTimelineChipRebindInstalled = true;
    for (const hook of ["onNodeCreated", "onAdded", "onConfigure"]) {
      const old = nodeType.prototype[hook];
      nodeType.prototype[hook] = function() { const result = old?.apply(this, arguments); installSoon(this); return result; };
    }
  },
  loadedGraphNode(node) { if (isTarget(node)) installSoon(node); },
});
