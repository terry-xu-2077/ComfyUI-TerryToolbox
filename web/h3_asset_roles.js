import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_ID = "TerryH3PromptEditor";
const LINKS_PROP = "terry_h3_virtual_media_links";
const BINDINGS_PROP = "terry_h3_subject_bindings";
const DEFAULT_ROLE_PROP = "terry_h3_default_image_role";
const VIEW_PROP = "terry_h3_view_mode";
const CARET = "\u200B";

function isTarget(node) {
  return [node?.comfyClass, node?.type, node?.constructor?.type, node?.constructor?.comfyClass, node?.constructor?.nodeData?.name]
    .some((value) => String(value || "") === NODE_ID);
}

function widget(node, name) {
  return node?.widgets?.find((item) => item?.name === name) || null;
}

function promptText(node) {
  return String(widget(node, "prompt")?.value || "");
}

function virtualLinks(node) {
  node.properties ||= {};
  const links = Array.isArray(node.properties[LINKS_PROP]) ? node.properties[LINKS_PROP] : [];
  return links.filter((link) => app.graph?.getNodeById?.(Number(link?.source_id)));
}

function sourceKind(source, slot, fallback = "") {
  const type = String(source?.outputs?.[slot]?.type || fallback || "").toUpperCase();
  if (type.includes("AUDIO")) return "audio";
  if (type.includes("VIDEO")) return "video";
  if (type.includes("IMAGE")) return "picture";
  const name = String(source?.comfyClass || source?.type || "").toLowerCase();
  if (name.includes("audio")) return "audio";
  if (name.includes("video")) return "video";
  return "picture";
}

function filenameFromSource(source, kind) {
  const preferred = kind === "picture" ? ["image", "filename", "file"] : kind === "video" ? ["video", "file", "filename", "video_file", "videofile"] : ["audio", "file", "filename", "audio_file", "audiofile"];
  const widgets = Array.isArray(source?.widgets) ? source.widgets : [];
  const ordered = [...widgets.filter((w) => preferred.includes(String(w?.name || "").toLowerCase())), ...widgets];
  for (const w of ordered) {
    const value = w?.value;
    const filename = typeof value === "object" ? (value?.filename || value?.name || "") : value;
    if (!filename || /^(data:|blob:|https?:)/i.test(String(filename))) continue;
    const name = String(w?.name || "").toLowerCase();
    if (preferred.includes(name) || /\.(png|jpe?g|webp|gif|bmp|tiff?|mp4|webm|mov|mkv|avi|m4v|mp3|wav|flac|ogg|m4a|aac)$/i.test(String(filename))) return String(filename);
  }
  return "";
}

function previewFromSource(source, kind) {
  if (!source || kind === "audio") return "";
  const filename = filenameFromSource(source, kind);
  if (filename) {
    const sourceWidget = (source.widgets || []).find((w) => {
      const value = w?.value;
      return String(typeof value === "object" ? (value?.filename || value?.name || "") : (value || "")) === filename;
    });
    const value = sourceWidget?.value;
    const query = new URLSearchParams({
      filename,
      type: typeof value === "object" ? String(value.type || "input") : "input",
    });
    if (typeof value === "object" && value.subfolder) query.set("subfolder", String(value.subfolder));
    return api.apiURL(`/view?${query.toString()}`);
  }
  const img = (source.imgs || []).find((item) => item?.src);
  if (img?.src) return img.src;
  for (const w of source.widgets || []) {
    const element = w?.element;
    const image = element?.matches?.("img") ? element : element?.querySelector?.("img");
    if (image?.src) return image.src;
    const video = element?.matches?.("video") ? element : element?.querySelector?.("video");
    if (kind === "video" && (video?.poster || video?.currentSrc || video?.src)) return video.poster || video.currentSrc || video.src;
  }
  return "";
}

function assetOptions(node) {
  const counts = { picture: 0, video: 0, audio: 0 };
  return virtualLinks(node).map((link) => {
    const source = app.graph?.getNodeById?.(Number(link.source_id));
    const slot = Number(link.source_slot) || 0;
    const kind = link.kind || sourceKind(source, slot, link.source_type);
    counts[kind] = (counts[kind] || 0) + 1;
    const index = counts[kind];
    const assetTag = kind === "picture" ? `<Picture ${index}>` : kind === "video" ? `<Video ${index}>` : `<Audio ${index}>`;
    return {
      key: `${Number(link.source_id)}:${slot}`,
      kind,
      index,
      assetTag,
      source,
      sourceId: Number(link.source_id),
      sourceSlot: slot,
      name: filenameFromSource(source, kind).split(/[\\/]/).pop() || source?.title || assetTag,
      preview: previewFromSource(source, kind),
    };
  });
}

function subjectBindings(node) {
  node.properties ||= {};
  if (!node.properties[BINDINGS_PROP] || typeof node.properties[BINDINGS_PROP] !== "object" || Array.isArray(node.properties[BINDINGS_PROP])) {
    node.properties[BINDINGS_PROP] = {};
  }
  return node.properties[BINDINGS_PROP];
}

function usedSubjectNumbers(node) {
  const used = new Set();
  for (const match of promptText(node).matchAll(/<Subject\s+(\d+)>/gi)) used.add(Number(match[1]));
  for (const list of Object.values(subjectBindings(node))) {
    for (const value of Array.isArray(list) ? list : []) used.add(Number(value));
  }
  return used;
}

function nextSubjectNumber(node) {
  const used = usedSubjectNumbers(node);
  let value = 1;
  while (used.has(value)) value += 1;
  return value;
}

function boundSubjects(node, asset) {
  const list = subjectBindings(node)[asset.key];
  return Array.isArray(list) ? list.map(Number).filter((x) => Number.isFinite(x) && x > 0) : [];
}

function createSubjectBinding(node, asset) {
  const bindings = subjectBindings(node);
  const number = nextSubjectNumber(node);
  bindings[asset.key] ||= [];
  bindings[asset.key].push(number);
  app.graph?.change?.();
  return number;
}

function ensurePrimarySubject(node, asset) {
  return boundSubjects(node, asset)[0] || createSubjectBinding(node, asset);
}

function roleHelp(kind, role) {
  if (role === "subject") {
    return kind === "video"
      ? "从视频中抽取人物、物体、场景、动作、表情或风格，作为后续镜头可复用的内容单元。"
      : "从图片中抽取人物、物体、场景、服装、风格、动作或姿态，作为后续镜头可复用的内容单元。";
  }
  if (role === "picture") return "直接引用这张图片本身：适合首帧、尾帧、关键帧、构图锚点或分镜规划。";
  if (role === "video") return "引用整段视频本身：适合视频编辑、续写、镜头运动、剪辑节奏或时间结构。";
  return "引用独立音频信号：适合完整/部分复用，或参考音色、节奏、对白、音乐与声音质感。";
}

function atRange(editor) {
  const selection = window.getSelection?.();
  if (!selection?.rangeCount || !selection.isCollapsed) return null;
  const caret = selection.getRangeAt(0);
  if (!editor.contains(caret.startContainer) || caret.startContainer.nodeType !== Node.TEXT_NODE) return null;
  const before = String(caret.startContainer.textContent || "").slice(0, caret.startOffset);
  const match = before.match(/@([^@\n]*)$/);
  if (!match) return null;
  const range = document.createRange();
  range.setStart(caret.startContainer, caret.startOffset - match[0].length);
  range.setEnd(caret.startContainer, caret.startOffset);
  return { range, query: match[1].trim().toLowerCase() };
}

function normalizeAtCaret(editor, event) {
  if (event.inputType !== "insertText" || event.data !== "@") return false;
  const selection = window.getSelection?.();
  if (!selection?.rangeCount || !editor.contains(selection.anchorNode)) return false;
  if (selection.anchorNode?.nodeType === Node.TEXT_NODE) return false;
  event.preventDefault();
  const range = selection.getRangeAt(0).cloneRange();
  range.deleteContents();
  const text = document.createTextNode("@");
  range.insertNode(text);
  const caret = document.createRange();
  caret.setStart(text, 1);
  caret.collapse(true);
  selection.removeAllRanges();
  selection.addRange(caret);
  return true;
}

function makeChip(raw, label, asset, subject = false) {
  const chip = document.createElement("span");
  chip.className = `terry-h3-chip ${subject ? "terry-h3-subject-asset-chip terry-h3-strong" : "terry-h3-media-chip"}`;
  chip.contentEditable = "false";
  chip.dataset.raw = raw;
  if (asset?.preview && asset.kind !== "audio") {
    const img = document.createElement("img");
    img.src = asset.preview;
    img.alt = "";
    img.draggable = false;
    chip.append(img);
  } else {
    const icon = document.createElement("span");
    icon.className = "terry-h3-media-icon";
    icon.textContent = subject ? "◇" : asset?.kind === "audio" ? "♪" : asset?.kind === "video" ? "▶" : "▧";
    chip.append(icon);
  }
  const text = document.createElement("span");
  text.textContent = label;
  chip.append(text);
  chip.title = subject
    ? `${label} · 来源 ${asset?.assetTag || asset?.name || "参考资产"} · ${roleHelp(asset?.kind, "subject")}`
    : `${label} · ${roleHelp(asset?.kind, asset?.kind)}`;
  return chip;
}

function closeMenu(node) {
  node.__terryH3RoleMenu?.remove?.();
  node.__terryH3RoleMenu = null;
  node.__terryH3RoleState = null;
}

function hideLegacyMention(node) {
  node.__terryH3Mention?.remove?.();
  node.__terryH3Mention = null;
}

function insertRole(node, asset, role, { freshSubject = false } = {}) {
  const state = node.__terryH3RoleState;
  const editor = node.__terryH3Editor;
  if (!state?.range || !editor) return;
  state.range.deleteContents();
  let raw = asset.assetTag;
  let label = asset.assetTag.slice(1, -1);
  let subject = false;
  if (role === "subject") {
    const number = freshSubject ? createSubjectBinding(node, asset) : ensurePrimarySubject(node, asset);
    raw = `<Subject ${number}>`;
    label = `Subject ${number}`;
    subject = true;
  }
  const chip = makeChip(raw, label, asset, subject);
  const after = document.createTextNode(CARET);
  const fragment = document.createDocumentFragment();
  fragment.append(chip, after);
  state.range.insertNode(fragment);
  const selection = window.getSelection?.();
  if (selection) {
    const caret = document.createRange();
    caret.setStart(after, after.textContent.length);
    caret.collapse(true);
    selection.removeAllRanges();
    selection.addRange(caret);
  }
  closeMenu(node);
  editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: null }));
  editor.focus({ preventScroll: true });
}

function setDefaultRole(node, role) {
  node.properties ||= {};
  node.properties[DEFAULT_ROLE_PROP] = role === "picture" ? "picture" : "subject";
  app.graph?.change?.();
}

function defaultRole(node) {
  return node?.properties?.[DEFAULT_ROLE_PROP] === "picture" ? "picture" : "subject";
}

function roleButton(text, title, className = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `terry-h3-role-action ${className}`;
  button.textContent = text;
  button.title = title;
  return button;
}

function renderRoleLegend(node, menu) {
  const legend = document.createElement("div");
  legend.className = "terry-h3-role-legend";
  const title = document.createElement("div");
  title.className = "terry-h3-role-title";
  title.innerHTML = "<b>引用角色</b><span>同一资产可以有不同 H3 角色</span>";
  const tabs = document.createElement("div");
  tabs.className = "terry-h3-role-tabs";
  const subject = roleButton("Subject · 内容", roleHelp("picture", "subject"), defaultRole(node) === "subject" ? "is-active" : "");
  const picture = roleButton("Picture · 画面", roleHelp("picture", "picture"), defaultRole(node) === "picture" ? "is-active" : "");
  subject.addEventListener("pointerdown", (event) => {
    event.preventDefault(); event.stopPropagation(); setDefaultRole(node, "subject"); openMenu(node);
  });
  picture.addEventListener("pointerdown", (event) => {
    event.preventDefault(); event.stopPropagation(); setDefaultRole(node, "picture"); openMenu(node);
  });
  tabs.append(subject, picture);
  const help = document.createElement("div");
  help.className = "terry-h3-role-help";
  help.textContent = defaultRole(node) === "subject" ? roleHelp("picture", "subject") : roleHelp("picture", "picture");
  legend.append(title, tabs, help);
  menu.append(legend);
}

function renderAssetRow(node, menu, asset) {
  const row = document.createElement("div");
  row.className = "terry-h3-role-row";
  const thumb = document.createElement("div");
  thumb.className = `terry-h3-role-thumb is-${asset.kind}`;
  if (asset.preview && asset.kind !== "audio") {
    const image = document.createElement("img"); image.src = asset.preview; image.alt = ""; thumb.append(image);
  } else thumb.textContent = asset.kind === "audio" ? "♪" : asset.kind === "video" ? "▶" : "▧";
  const info = document.createElement("div");
  info.className = "terry-h3-role-info";
  const name = document.createElement("b"); name.textContent = asset.name;
  const meta = document.createElement("small");
  meta.textContent = asset.kind === "picture" ? `图片资产 · Picture ${asset.index}` : asset.kind === "video" ? `视频资产 · Video ${asset.index}` : `音频资产 · Audio ${asset.index}`;
  info.append(name, meta);
  const actions = document.createElement("div");
  actions.className = "terry-h3-role-actions";

  if (asset.kind === "picture" || asset.kind === "video") {
    const subjects = boundSubjects(node, asset);
    const primary = subjects[0];
    const subjectLabel = primary ? `Subject ${primary}` : "+ Subject";
    const subjectButton = roleButton(subjectLabel, roleHelp(asset.kind, "subject"), defaultRole(node) === "subject" ? "is-primary" : "");
    subjectButton.addEventListener("pointerdown", (event) => {
      event.preventDefault(); event.stopPropagation(); insertRole(node, asset, "subject");
    });
    actions.append(subjectButton);
    if (primary) {
      const fresh = roleButton("+ 新 Subject", "同一资产里再定义一个独立的 Subject，例如同一张图里的第二个人物或环境。", "is-secondary");
      fresh.addEventListener("pointerdown", (event) => {
        event.preventDefault(); event.stopPropagation(); insertRole(node, asset, "subject", { freshSubject: true });
      });
      actions.append(fresh);
    }
  }

  const assetRole = asset.kind;
  const assetLabel = asset.kind === "picture" ? `Picture ${asset.index}` : asset.kind === "video" ? `Video ${asset.index}` : `Audio ${asset.index}`;
  const direct = roleButton(assetLabel, roleHelp(asset.kind, assetRole), asset.kind === "picture" && defaultRole(node) === "picture" ? "is-primary" : "");
  direct.addEventListener("pointerdown", (event) => {
    event.preventDefault(); event.stopPropagation(); insertRole(node, asset, assetRole);
  });
  actions.append(direct);
  row.append(thumb, info, actions);
  menu.append(row);
}

function positionMenu(menu, editor) {
  const selection = window.getSelection?.();
  const caret = selection?.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : null;
  const rect = caret && (caret.width || caret.height) ? caret : editor.getBoundingClientRect();
  const width = 420;
  const height = Math.min(520, menu.offsetHeight || 400);
  let left = rect.left;
  let top = rect.bottom + 6;
  if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
  if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 6);
  menu.style.left = `${Math.max(8, Math.round(left))}px`;
  menu.style.top = `${Math.max(8, Math.round(top))}px`;
}

function openMenu(node) {
  if (node?.properties?.[VIEW_PROP] === "raw") { closeMenu(node); return false; }
  const editor = node.__terryH3Editor;
  const hit = atRange(editor);
  if (!hit) { closeMenu(node); return false; }
  hideLegacyMention(node);
  const all = assetOptions(node);
  const options = all.filter((asset) => !hit.query || `${asset.name} ${asset.assetTag} ${asset.kind}`.toLowerCase().includes(hit.query));
  let state = node.__terryH3RoleState;
  if (!state) {
    const menu = document.createElement("div");
    menu.className = "terry-h3-role-menu";
    document.body.append(menu);
    state = node.__terryH3RoleState = { menu, range: hit.range, options };
    node.__terryH3RoleMenu = menu;
  } else {
    state.range = hit.range;
    state.options = options;
  }
  const menu = state.menu;
  menu.replaceChildren();
  renderRoleLegend(node, menu);
  if (!options.length) {
    const empty = document.createElement("div");
    empty.className = "terry-h3-role-empty";
    empty.textContent = "没有匹配资产。先把图片 / 视频 / 音频连接到左侧参考输入。";
    menu.append(empty);
  } else options.forEach((asset) => renderAssetRow(node, menu, asset));
  positionMenu(menu, editor);
  return true;
}

function bindEditor(node) {
  const editor = node.__terryH3Editor;
  if (!editor || editor.__terryH3AssetRolesBound) return false;
  editor.__terryH3AssetRolesBound = true;
  editor.addEventListener("beforeinput", (event) => {
    if (node?.properties?.[VIEW_PROP] === "raw") return;
    const normalized = normalizeAtCaret(editor, event);
    if (normalized || (event.inputType === "insertText" && event.data === "@")) {
      setTimeout(() => { hideLegacyMention(node); openMenu(node); }, 0);
      setTimeout(() => { hideLegacyMention(node); openMenu(node); }, 20);
    }
  }, true);
  editor.addEventListener("input", () => {
    if (node?.properties?.[VIEW_PROP] === "raw") { closeMenu(node); return; }
    queueMicrotask(() => { hideLegacyMention(node); openMenu(node); });
  });
  editor.addEventListener("keyup", (event) => {
    if (event.key === "Escape") closeMenu(node);
    else if (!["ArrowUp", "ArrowDown", "Enter", "Tab"].includes(event.key)) setTimeout(() => { hideLegacyMention(node); openMenu(node); }, 0);
  }, true);
  editor.addEventListener("blur", () => setTimeout(() => {
    if (!node.__terryH3RoleMenu?.matches?.(":hover")) closeMenu(node);
  }, 170));
  return true;
}

function installSoon(node) {
  if (!isTarget(node)) return;
  if (bindEditor(node)) return;
  let attempts = 0;
  const retry = () => {
    attempts += 1;
    if (bindEditor(node) || attempts >= 12) return;
    setTimeout(retry, Math.min(1000, attempts * 70));
  };
  setTimeout(retry, 0);
}

function installStyle() {
  if (document.getElementById("terry-h3-asset-role-style")) return;
  const style = document.createElement("style");
  style.id = "terry-h3-asset-role-style";
  style.textContent = `
.terry-h3-role-menu{position:fixed;z-index:10100;width:420px;max-height:520px;overflow:auto;padding:6px;border:1px solid rgba(255,255,255,.15);border-radius:10px;background:var(--comfy-menu-bg,#202225);box-shadow:0 18px 44px rgba(0,0,0,.5);color:var(--input-text,#ddd)}
.terry-h3-role-legend{position:sticky;top:-6px;z-index:3;margin:-1px -1px 5px;padding:8px 9px 9px;border-bottom:1px solid rgba(255,255,255,.1);background:var(--comfy-menu-bg,#202225)}
.terry-h3-role-title{display:flex;align-items:center;justify-content:space-between;gap:10px;font:12px/1.3 system-ui,sans-serif}.terry-h3-role-title span{font-size:10px;opacity:.48}
.terry-h3-role-tabs{display:flex;gap:5px;margin-top:7px}.terry-h3-role-help{margin-top:6px;font:10px/1.45 system-ui,sans-serif;opacity:.58}
.terry-h3-role-row{display:grid;grid-template-columns:46px minmax(90px,1fr) auto;gap:9px;align-items:center;padding:7px;border-radius:8px}.terry-h3-role-row:hover{background:rgba(255,255,255,.055)}
.terry-h3-role-thumb{display:grid;place-items:center;width:44px;height:44px;border-radius:6px;background:rgba(255,255,255,.08);overflow:hidden;font:700 14px/1 system-ui,sans-serif}.terry-h3-role-thumb img{width:100%;height:100%;object-fit:cover}
.terry-h3-role-info{min-width:0}.terry-h3-role-info b,.terry-h3-role-info small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.terry-h3-role-info b{font:600 11px/1.3 system-ui,sans-serif}.terry-h3-role-info small{margin-top:4px;font:10px/1.25 system-ui,sans-serif;opacity:.5}
.terry-h3-role-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:4px;max-width:210px}
.terry-h3-role-action{height:25px;padding:0 7px;border:1px solid rgba(255,255,255,.11);border-radius:5px;background:rgba(255,255,255,.045);color:inherit;cursor:pointer;font:600 10px/1 system-ui,sans-serif;white-space:nowrap}.terry-h3-role-action:hover{background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.2)}
.terry-h3-role-action.is-active,.terry-h3-role-action.is-primary{background:rgba(0,226,187,.1);border-color:rgba(0,226,187,.24);color:rgba(190,255,244,.98)}.terry-h3-role-action.is-secondary{opacity:.62}
.terry-h3-role-empty{padding:14px 10px;font:11px/1.5 system-ui,sans-serif;opacity:.62}
.terry-h3-subject-asset-chip img{width:26px;height:26px;object-fit:cover;border-radius:3px;margin-right:1px}.terry-h3-subject-asset-chip{color:rgba(210,235,255,.98);background:rgba(90,169,240,.12)}
`;
  document.head.append(style);
}

app.registerExtension({
  name: "TerryToolbox.H3AssetRoles",
  setup() {
    installStyle();
    document.addEventListener("pointerdown", (event) => {
      for (const node of app.graph?._nodes || []) {
        if (!isTarget(node) || !node.__terryH3RoleMenu) continue;
        if (node.__terryH3RoleMenu.contains(event.target) || node.__terryH3Wrap?.contains?.(event.target)) continue;
        closeMenu(node);
      }
    }, true);
  },
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_ID || nodeType.prototype.__terryH3AssetRolesInstalled) return;
    nodeType.prototype.__terryH3AssetRolesInstalled = true;
    const created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function() { const result = created?.apply(this, arguments); installSoon(this); return result; };
    const added = nodeType.prototype.onAdded;
    nodeType.prototype.onAdded = function() { const result = added?.apply(this, arguments); installSoon(this); return result; };
    const configured = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function() { const result = configured?.apply(this, arguments); installSoon(this); return result; };
    const draw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function() { const result = draw?.apply(this, arguments); if (this.__terryH3Editor) bindEditor(this); return result; };
  },
  loadedGraphNode(node) { installSoon(node); },
});
