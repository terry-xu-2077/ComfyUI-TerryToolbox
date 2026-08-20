import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_ID = "TerryH3PromptEditor";
const SECTIONS = new Set([
  "subject_definitions", "summary", "retention_analysis",
  "detailed_description", "overall_soundscape", "non_diegetic_music"
]);
const MARKERS = new Set([
  "fully_preserved", "partially_preserved", "attribute_transfer", "weak_reference",
  "fully_copy", "partially_copy", "reference"
]);
const LANGUAGES = [
  "English", "Chinese", "Cantonese", "Japanese", "Korean", "Spanish", "French",
  "German", "Italian", "Portuguese", "Russian", "Arabic", "Hindi", "Thai",
  "Vietnamese", "Indonesian", "Turkish", "Polish", "Dutch", "Other"
];

function widget(node, name) {
  return node.widgets?.find((w) => w.name === name);
}

function hideNativeWidget(w) {
  if (!w || w.__terryH3Hidden) return;
  w.__terryH3Hidden = true;
  w.hidden = true;
  if (w.options) w.options.hidden = true;
  if (w.element?.style) w.element.style.display = "none";
  const old = typeof w.computeSize === "function" ? w.computeSize.bind(w) : null;
  w.computeSize = function(width) {
    if (this.hidden) return [0, -4];
    return old ? old(width) : [width || 0, 20];
  };
}

function viewUrl(item) {
  if (!item?.filename) return "";
  const q = new URLSearchParams({
    filename: item.filename,
    type: item.folder_type || item.type || "temp",
    subfolder: item.subfolder || "",
  });
  return api.apiURL(`/view?${q.toString()}`);
}

function linkType(node, input) {
  if (!input || input.link == null) return "";
  const link = app.graph?.links?.[input.link];
  if (!link) return "";
  let type = String(link.type || "").toUpperCase();
  if (!type || type === "*") {
    const origin = app.graph?.getNodeById?.(link.origin_id);
    type = String(origin?.outputs?.[link.origin_slot]?.type || "").toUpperCase();
  }
  return type;
}

function sourceNode(node, input) {
  if (!input || input.link == null) return null;
  const link = app.graph?.links?.[input.link];
  return link ? app.graph?.getNodeById?.(link.origin_id) : null;
}

function classify(type) {
  if (type === "IMAGE") return "picture";
  if (type === "VIDEO") return "video";
  if (type === "AUDIO") return "audio";
  return "other";
}

function getGraphLink(linkId) {
  if (linkId == null) return null;
  const graph = app.graph;
  for (const links of [graph?.links, graph?._links]) {
    if (!links) continue;
    if (typeof links.get === "function") {
      const found = links.get(linkId) ?? links.get(String(linkId));
      if (found) return found;
    }
    const found = links[linkId] ?? links[String(linkId)];
    if (found) return found;
  }
  return null;
}

function mediaFilename(value) {
  const candidate = typeof value === "object"
    ? (value?.filename || value?.name || "")
    : value;
  const text = String(candidate || "").trim();
  if (!text || /^(data:|blob:|https?:)/i.test(text)) return "";
  return text;
}

function sourceFilename(origin, kind) {
  if (!origin) return "";

  const preferred = {
    picture: ["image", "filename", "file"],
    video: ["video", "file", "filename", "video_file", "videofile"],
    audio: ["audio", "file", "filename", "audio_file", "audiofile"],
  }[kind] || ["file", "filename"];

  const preferredSet = new Set(preferred);
  const widgets = Array.isArray(origin.widgets) ? origin.widgets : [];
  const ordered = [
    ...widgets.filter((w) => preferredSet.has(String(w?.name || "").toLowerCase())),
    ...widgets,
  ];

  for (const w of ordered) {
    const name = String(w?.name || "").toLowerCase();
    const filename = mediaFilename(w?.value);
    if (!filename) continue;

    const looksLikeMedia = /\.(png|jpe?g|webp|gif|bmp|tiff?|mp4|webm|mov|mkv|avi|m4v|mp3|wav|flac|ogg|m4a|aac)$/i.test(filename);
    if (preferredSet.has(name) || looksLikeMedia) return filename;
  }

  return mediaFilename(origin?.properties?.filename || origin?.properties?.file || "");
}

function mediaViewUrlFromSource(origin, kind) {
  if (!origin) return "";

  const preferred = {
    picture: ["image", "filename", "file"],
    video: ["video", "file", "filename", "video_file", "videofile"],
    audio: ["audio", "file", "filename", "audio_file", "audiofile"],
  }[kind] || ["file", "filename"];

  const preferredSet = new Set(preferred);
  const widgets = Array.isArray(origin.widgets) ? origin.widgets : [];
  const candidates = [
    ...widgets.filter((w) => preferredSet.has(String(w?.name || "").toLowerCase())),
    ...widgets,
  ];

  for (const w of candidates) {
    const value = w?.value;
    if (!value) continue;

    const filename = typeof value === "object"
      ? (value?.filename || value?.name)
      : value;
    if (!filename || /^(data:|blob:|https?:)/i.test(String(filename))) continue;

    const name = String(w?.name || "").toLowerCase();
    const extOk =
      kind === "picture" ? /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(String(filename)) :
      kind === "video" ? /\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(String(filename)) :
      kind === "audio" ? /\.(mp3|wav|flac|ogg|m4a|aac)$/i.test(String(filename)) :
      true;

    if (!preferredSet.has(name) && !extOk) continue;

    const q = new URLSearchParams({
      filename: String(filename),
      type: typeof value === "object" ? String(value.type || "input") : "input",
    });
    if (typeof value === "object" && value.subfolder) {
      q.set("subfolder", String(value.subfolder));
    }
    return api.apiURL(`/view?${q.toString()}`);
  }
  return "";
}

function sourcePreviewUrl(origin, kind) {
  if (!origin || kind === "audio") return "";

  const direct = mediaViewUrlFromSource(origin, kind);
  if (direct) return direct;

  const imgs = Array.isArray(origin.imgs) ? origin.imgs : [];
  const img = imgs.find((x) => x?.src);
  if (img?.src) return img.src;

  for (const w of origin.widgets || []) {
    const el = w?.element;
    const image = el?.matches?.("img") ? el : el?.querySelector?.("img");
    if (image?.src) return image.src;

    if (kind === "video") {
      const video = el?.matches?.("video") ? el : el?.querySelector?.("video");
      if (video?.currentSrc || video?.src) return video.currentSrc || video.src;
      if (video?.poster) return video.poster;
    }
  }

  return "";
}

let liveAssetRefreshTimer = null;

function requestLiveAssetRefresh() {
  if (liveAssetRefreshTimer) return;
  liveAssetRefreshTimer = setTimeout(() => {
    liveAssetRefreshTimer = null;
    for (const n of app.graph?._nodes || []) {
      if (n?.comfyClass === NODE_ID || n?.constructor?.type === NODE_ID) {
        n.__terryH3?.connectionChanged();
      }
    }
  }, 0);
}

function watchSourceNode(origin) {
  if (!origin) return;
  for (const w of origin.widgets || []) {
    if (!w || w.__terryH3MediaWatch) continue;
    w.__terryH3MediaWatch = true;

    const old = w.callback;
    w.callback = function(...args) {
      const result = old?.apply(this, args);
      requestLiveAssetRefresh();
      return result;
    };

    const el = w.inputEl || w.element;
    el?.addEventListener?.("change", requestLiveAssetRefresh, true);
    el?.addEventListener?.("input", requestLiveAssetRefresh, true);
  }
}

function graphAssets(node) {
  const counts = { picture: 0, video: 0, audio: 0, other: 0 };
  const out = [];

  for (const input of node.inputs || []) {
    if (!String(input.name || "").includes("asset") || input.link == null) continue;

    const link = getGraphLink(input.link);
    const origin = link
      ? app.graph?.getNodeById?.(link.origin_id ?? link.originId)
      : sourceNode(node, input);

    const originSlot = Number(link?.origin_slot ?? link?.originSlot ?? 0) || 0;
    let type = String(
      link?.type ||
      origin?.outputs?.[originSlot]?.type ||
      linkType(node, input) ||
      ""
    ).toUpperCase();

    if (!type || type === "*") type = linkType(node, input);

    const kind = classify(type);
    counts[kind] += 1;
    const index = counts[kind];

    watchSourceNode(origin);

    const filename = sourceFilename(origin, kind);
    const url = sourcePreviewUrl(origin, kind);

    out.push({
      input_name: input.name,
      kind,
      index,
      label:
        kind === "picture" ? `Picture ${index}` :
        kind === "video" ? `Video ${index}` :
        kind === "audio" ? `Audio ${index}` :
        `Asset ${index}`,
      source_name: filename
        ? filename.split(/[\/]/).pop()
        : (origin?.title || origin?.getTitle?.() || input.name),
      filename,
      url,
    });
  }

  return out;
}

function mergeAssets(graphList, executedList) {
  const byInput = new Map((executedList || []).map((x) => [x.input_name, x]));
  return graphList.map((g) => {
    const e = byInput.get(g.input_name) || {};
    return {
      ...g,
      ...e,
      source_name: g.source_name,
      filename: g.filename || e.filename || "",
      url: g.url || viewUrl(e),
    };
  });
}

function rawFromVisual(root) {
  let out = "";
  const walk = (parent) => {
    for (const child of parent.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        out += child.nodeValue || "";
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const el = child;
      if (el.classList.contains("terry-h3-dialogue")) {
        const lang = el.querySelector("select")?.value || "English";
        const text = el.querySelector(".terry-h3-dialogue-text")?.innerText || "";
        out += `<d>[${lang}] ${text}</d>`;
      } else if (el.dataset?.raw != null) {
        out += el.dataset.raw;
      } else if (el.tagName === "BR") {
        out += "\n";
      } else {
        walk(el);
        if (el.tagName === "DIV" || el.tagName === "P") out += "\n";
      }
    }
  };
  walk(root);
  return out.replaceAll("\u00a0", " ");
}

function chip(raw, text, extra = "") {
  const el = document.createElement("span");
  el.contentEditable = "false";
  el.dataset.raw = raw;
  el.textContent = text;
  el.style.cssText = `display:inline-flex;align-items:center;vertical-align:middle;margin:1px 2px;padding:2px 6px;border:1px solid rgba(255,255,255,.13);border-radius:5px;background:rgba(255,255,255,.07);font:11px/1.25 Inter,Arial,sans-serif;white-space:nowrap;${extra}`;
  return el;
}

function createEditor(node) {
  const promptWidget = widget(node, "prompt");
  hideNativeWidget(promptWidget);

  const root = document.createElement("div");
  root.style.cssText = "position:relative;width:100%;box-sizing:border-box;padding:4px;color:var(--fg-color,#ddd);font-family:Inter,Arial,sans-serif;";

  const toolbar = document.createElement("div");
  toolbar.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:6px;";
  const tabs = document.createElement("div");
  tabs.style.cssText = "display:flex;gap:4px;";
  const visualBtn = document.createElement("button");
  const sourceBtn = document.createElement("button");
  visualBtn.type = sourceBtn.type = "button";
  visualBtn.textContent = "可视化";
  sourceBtn.textContent = "原文";
  for (const b of [visualBtn, sourceBtn]) {
    b.style.cssText = "height:27px;padding:0 10px;border-radius:5px;border:1px solid rgba(255,255,255,.13);background:rgba(255,255,255,.06);color:inherit;cursor:pointer;font-size:11px;";
  }
  tabs.append(visualBtn, sourceBtn);
  const hint = document.createElement("div");
  hint.textContent = "@ 插入参考 · 标签自动可视化";
  hint.style.cssText = "font-size:10px;opacity:.58;";
  toolbar.append(tabs, hint);

  const visual = document.createElement("div");
  visual.contentEditable = "true";
  visual.spellcheck = false;
  visual.style.cssText = "min-height:330px;max-height:700px;overflow:auto;box-sizing:border-box;padding:11px 12px;border:1px solid rgba(255,255,255,.12);border-radius:6px;background:rgba(0,0,0,.18);font:12px/1.62 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;word-break:break-word;outline:none;";

  const source = document.createElement("textarea");
  source.spellcheck = false;
  source.style.cssText = "display:none;width:100%;min-height:330px;max-height:700px;resize:vertical;box-sizing:border-box;padding:11px 12px;border:1px solid rgba(255,255,255,.12);border-radius:6px;background:rgba(0,0,0,.18);color:inherit;font:12px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace;outline:none;";

  const menu = document.createElement("div");
  menu.style.cssText = "display:none;position:absolute;z-index:9999;left:8px;top:70px;width:270px;max-height:310px;overflow:auto;padding:4px;border-radius:7px;border:1px solid rgba(255,255,255,.15);background:var(--comfy-menu-bg,#202225);box-shadow:0 8px 24px rgba(0,0,0,.4);";

  const footer = document.createElement("div");
  footer.style.cssText = "display:flex;justify-content:space-between;gap:8px;margin-top:5px;font-size:10px;opacity:.58;";
  const assetState = document.createElement("span");
  const syncState = document.createElement("span");
  footer.append(assetState, syncState);
  root.append(toolbar, visual, source, menu, footer);

  let mode = "visual";
  let executedAssets = [];
  let assets = [];
  let suppress = false;
  let atRange = null;
  let activeTagChip = null;

  const rawValue = () => String(promptWidget?.value ?? "");
  const setRawValue = (v) => {
    if (!promptWidget) return;
    promptWidget.value = v;
    promptWidget.callback?.(v);
    node.setDirtyCanvas?.(true, true);
  };

  function refreshAssets() {
    assets = mergeAssets(graphAssets(node), executedAssets);
    const pc = assets.filter((a) => a.kind === "picture").length;
    const vc = assets.filter((a) => a.kind === "video").length;
    const ac = assets.filter((a) => a.kind === "audio").length;
    assetState.textContent = `参考：图片 ${pc} · 视频 ${vc} · 音频 ${ac}`;
  }

  function asset(kind, index) {
    return assets.find((x) => x.kind === kind && Number(x.index) === Number(index));
  }

  function positionMenu(anchor) {
    const rootRect = root.getBoundingClientRect();
    const rect = anchor?.getBoundingClientRect?.();
    if (!rect) return;
    const width = 270;
    const left = Math.max(4, Math.min(rect.left - rootRect.left, rootRect.width - width - 4));
    menu.style.left = `${left}px`;
    menu.style.top = `${Math.max(4, rect.bottom - rootRect.top + 4)}px`;
  }

  function replaceTagChip(el, raw) {
    if (!el || !visual.contains(el)) return;
    el.dataset.raw = raw;
    syncFromVisual();
    render(rawValue());
    closeMenu();
  }

  function assetChip(kind, index, raw) {
    const item = asset(kind, index);
    const el = chip(raw, "");
    el.replaceChildren();
    el.style.padding = "2px 6px 2px 3px";
    if (kind === "picture" && item?.url) {
      const img = document.createElement("img");
      img.src = item.url;
      img.alt = item.label;
      img.style.cssText = "width:28px;height:28px;object-fit:cover;border-radius:3px;background:#111;";
      el.append(img);
    } else if (kind === "video" && item?.url) {
      const v = document.createElement("video");
      v.src = item.url;
      v.muted = true;
      v.preload = "metadata";
      v.style.cssText = "width:32px;height:28px;object-fit:cover;border-radius:3px;background:#111;";
      el.append(v);
    } else {
      const icon = document.createElement("span");
      icon.textContent = kind === "audio" ? "♪" : kind === "video" ? "▶" : "▧";
      icon.style.cssText = "display:grid;place-items:center;width:24px;height:24px;border-radius:3px;background:rgba(255,255,255,.08);font:bold 12px sans-serif;";
      el.append(icon);
    }
    const t = document.createElement("span");
    t.textContent = item?.label || raw.slice(1, -1);
    el.append(t);
    el.title = item?.source_name ? `${raw}\n来源：${item.source_name}` : raw;
    if (kind === "picture") {
      el.style.cursor = "pointer";
      el.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        showSubjectPictureMenu(el, "picture", index);
      });
    }
    return el;
  }

  function subjectChip(index, raw) {
    const el = chip(raw, `◇ Subject ${index}`, "font-weight:600;background:rgba(255,255,255,.09);cursor:pointer;");
    el.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      showSubjectPictureMenu(el, "subject", index);
    });
    return el;
  }

  function dialogue(lang, text) {
    const wrap = document.createElement("span");
    wrap.className = "terry-h3-dialogue";
    wrap.contentEditable = "false";
    wrap.style.cssText = "display:inline-flex;align-items:baseline;gap:5px;vertical-align:middle;margin:1px 2px;padding:2px 5px;border:1px solid rgba(255,255,255,.12);border-radius:5px;background:rgba(255,255,255,.045);";
    const select = document.createElement("select");
    select.style.cssText = "max-width:105px;height:22px;border:0;border-radius:4px;background:rgba(255,255,255,.10);color:inherit;font:10px Inter,Arial,sans-serif;outline:none;";
    const options = [...LANGUAGES];
    if (lang && !options.includes(lang)) options.unshift(lang);
    for (const name of options) {
      const o = document.createElement("option");
      o.value = o.textContent = name;
      o.selected = name === lang;
      select.append(o);
    }
    const body = document.createElement("span");
    body.className = "terry-h3-dialogue-text";
    body.contentEditable = "true";
    body.textContent = text;
    body.style.cssText = "min-width:28px;outline:none;white-space:pre-wrap;font:12px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace;";
    select.addEventListener("change", syncFromVisual);
    body.addEventListener("input", syncFromVisual);
    wrap.append(select, body);
    return wrap;
  }

  function render(raw) {
    suppress = true;
    visual.replaceChildren();
    const rx = /<d>\[([^\]]+)\]\s*([\s\S]*?)<\/d>|<(Subject|Picture|Video|Audio)\s+(\d+)>|\[Shot\s+\d+\]|\(S\d+\)|<scenetrans>|<cutoff>|\b(?:fully_preserved|partially_preserved|attribute_transfer|weak_reference|fully_copy|partially_copy|reference)\b|\b\d{2}:\d{2}\.\d{3}\b|^[a-z_]+:/gmi;
    let last = 0;
    let m;
    while ((m = rx.exec(raw))) {
      if (m.index > last) visual.append(document.createTextNode(raw.slice(last, m.index)));
      const token = m[0];
      if (m[1] != null) {
        visual.append(dialogue(m[1], m[2] || ""));
      } else if (m[3]) {
        const kind = m[3].toLowerCase();
        if (["picture", "video", "audio"].includes(kind)) visual.append(assetChip(kind, Number(m[4]), token));
        else visual.append(subjectChip(Number(m[4]), token));
      } else if (/^\[Shot/i.test(token)) {
        visual.append(chip(token, `🎬 ${token.slice(1, -1)}`, "font-weight:600;"));
      } else if (/^\(S\d+\)$/i.test(token)) {
        visual.append(chip(token, `🎙 ${token.slice(1, -1)}`));
      } else if (token === "<scenetrans>") {
        visual.append(chip(token, "↪ scene transition"));
      } else if (token === "<cutoff>") {
        visual.append(chip(token, "✂ cutoff"));
      } else if (MARKERS.has(token)) {
        visual.append(chip(token, token.replaceAll("_", " ")));
      } else if (/^\d{2}:\d{2}\.\d{3}$/.test(token)) {
        visual.append(chip(token, `⏱ ${token}`));
      } else if (/^[a-z_]+:$/i.test(token)) {
        const key = token.slice(0, -1).toLowerCase();
        if (SECTIONS.has(key)) visual.append(chip(token, key.replaceAll("_", " "), "font-weight:700;background:rgba(255,255,255,.11);"));
        else visual.append(document.createTextNode(token));
      } else {
        visual.append(document.createTextNode(token));
      }
      last = rx.lastIndex;
    }
    if (last < raw.length) visual.append(document.createTextNode(raw.slice(last)));
    suppress = false;
    syncState.textContent = "标准 H3 原文";
  }

  function syncFromVisual() {
    if (suppress) return;
    const raw = rawFromVisual(visual);
    source.value = raw;
    setRawValue(raw);
    syncState.textContent = "已同步";
  }

  function setMode(next) {
    if (next === mode) return;
    if (mode === "visual") syncFromVisual();
    else {
      setRawValue(source.value);
      render(source.value);
    }
    mode = next;
    visual.style.display = mode === "visual" ? "block" : "none";
    source.style.display = mode === "source" ? "block" : "none";
    visualBtn.style.background = mode === "visual" ? "rgba(255,255,255,.14)" : "rgba(255,255,255,.06)";
    sourceBtn.style.background = mode === "source" ? "rgba(255,255,255,.14)" : "rgba(255,255,255,.06)";
  }

  visualBtn.addEventListener("click", () => setMode("visual"));
  sourceBtn.addEventListener("click", () => setMode("source"));
  source.addEventListener("input", () => {
    setRawValue(source.value);
    syncState.textContent = "原文已修改";
  });
  visual.addEventListener("input", syncFromVisual);
  visual.addEventListener("paste", () => queueMicrotask(() => {
    syncFromVisual();
    render(rawValue());
  }));

  function closeMenu() {
    menu.style.display = "none";
    menu.replaceChildren();
    atRange = null;
    activeTagChip = null;
  }

  function atQuery() {
    const sel = window.getSelection();
    if (!sel?.rangeCount || !visual.contains(sel.anchorNode) || sel.anchorNode?.nodeType !== Node.TEXT_NODE) return null;
    const text = sel.anchorNode.nodeValue || "";
    const pos = sel.anchorOffset;
    const m = text.slice(0, pos).match(/@([A-Za-z0-9 _-]*)$/);
    if (!m) return null;
    const range = document.createRange();
    range.setStart(sel.anchorNode, pos - m[0].length);
    range.setEnd(sel.anchorNode, pos);
    return { range, query: m[1].trim().toLowerCase() };
  }

  function insertRaw(raw) {
    if (!atRange) return;
    atRange.deleteContents();
    const n = document.createTextNode(raw + " ");
    atRange.insertNode(n);
    const sel = window.getSelection();
    const r = document.createRange();
    r.setStartAfter(n);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
    syncFromVisual();
    render(rawValue());
    closeMenu();
    visual.focus();
  }

  function appendPictureAssetButton(item, onPick) {
    const b = document.createElement("button");
    b.type = "button";
    b.style.cssText = "display:flex;width:100%;align-items:center;gap:8px;min-height:42px;padding:4px 6px;border:0;border-radius:5px;background:transparent;color:inherit;text-align:left;cursor:pointer;";
    if (item.url) {
      const img = document.createElement("img");
      img.src = item.url;
      img.style.cssText = "width:34px;height:34px;object-fit:cover;border-radius:4px;background:#111;";
      b.append(img);
    } else {
      const i = document.createElement("div");
      i.textContent = "▧";
      i.style.cssText = "display:grid;place-items:center;width:34px;height:34px;border-radius:4px;background:rgba(255,255,255,.08);font:bold 15px sans-serif;";
      b.append(i);
    }
    const texts = document.createElement("div");
    texts.style.minWidth = "0";
    const title = document.createElement("div");
    title.textContent = `图片 ${item.index}`;
    title.style.cssText = "font-size:11px;font-weight:600;";
    const sub = document.createElement("div");
    sub.textContent = item.source_name || item.input_name;
    sub.style.cssText = "margin-top:2px;font-size:10px;opacity:.55;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
    texts.append(title, sub);
    b.append(texts);
    b.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      onPick(item);
    });
    menu.append(b);
  }

  function showSubjectPictureMenu(el, currentKind, index) {
    refreshAssets();
    activeTagChip = el;
    atRange = null;
    menu.replaceChildren();

    const head = document.createElement("div");
    head.style.cssText = "padding:6px 7px 7px;border-bottom:1px solid rgba(255,255,255,.10);";
    const title = document.createElement("div");
    title.textContent = `${currentKind === "subject" ? "主体" : "图片"} ${index} · 切换标签类型`;
    title.style.cssText = "font-size:11px;font-weight:700;";
    const switchRow = document.createElement("div");
    switchRow.style.cssText = "display:flex;gap:5px;margin-top:7px;";

    const subjectBtn = document.createElement("button");
    subjectBtn.type = "button";
    subjectBtn.textContent = "主体";
    subjectBtn.style.cssText = `flex:1;height:28px;border-radius:5px;border:1px solid rgba(255,255,255,.13);background:${currentKind === "subject" ? "rgba(255,255,255,.17)" : "rgba(255,255,255,.06)"};color:inherit;cursor:pointer;font-size:11px;font-weight:600;`;
    subjectBtn.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (currentKind === "subject") { closeMenu(); return; }
      replaceTagChip(activeTagChip, `<Subject ${index}>`);
    });

    const pictureBtn = document.createElement("button");
    pictureBtn.type = "button";
    pictureBtn.textContent = "图片";
    pictureBtn.style.cssText = `flex:1;height:28px;border-radius:5px;border:1px solid rgba(255,255,255,.13);background:${currentKind === "picture" ? "rgba(255,255,255,.17)" : "rgba(255,255,255,.06)"};color:inherit;cursor:pointer;font-size:11px;font-weight:600;`;
    pictureBtn.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const same = asset("picture", index);
      if (same) replaceTagChip(activeTagChip, `<Picture ${index}>`);
    });

    switchRow.append(subjectBtn, pictureBtn);
    head.append(title, switchRow);
    menu.append(head);

    const pictures = assets.filter((a) => a.kind === "picture");
    const note = document.createElement("div");
    note.textContent = pictures.length ? "选择图片来源" : "当前没有连接图片";
    note.style.cssText = "padding:7px 7px 4px;font-size:10px;opacity:.58;";
    menu.append(note);
    for (const item of pictures) {
      appendPictureAssetButton(item, (picked) => {
        replaceTagChip(activeTagChip, `<Picture ${picked.index}>`);
      });
    }

    positionMenu(el);
    menu.style.display = "block";
  }

  function showMenu(info) {
    refreshAssets();
    const found = assets.filter((a) => !info.query || `${a.label} ${a.source_name}`.toLowerCase().includes(info.query));
    menu.replaceChildren();
    if (!found.length) {
      const e = document.createElement("div");
      e.textContent = assets.length ? "没有匹配参考" : "先连接图片 / 视频 / 音频";
      e.style.cssText = "padding:8px;font-size:11px;opacity:.65;";
      menu.append(e);
    }
    for (const item of found) {
      const b = document.createElement("button");
      b.type = "button";
      b.style.cssText = "display:flex;width:100%;align-items:center;gap:8px;min-height:42px;padding:4px 6px;border:0;border-radius:5px;background:transparent;color:inherit;text-align:left;cursor:pointer;";
      if (item.kind === "picture" && item.url) {
        const img = document.createElement("img");
        img.src = item.url;
        img.style.cssText = "width:34px;height:34px;object-fit:cover;border-radius:4px;background:#111;";
        b.append(img);
      } else if (item.kind === "video" && item.url) {
        const v = document.createElement("video");
        v.src = item.url; v.muted = true; v.preload = "metadata";
        v.style.cssText = "width:40px;height:34px;object-fit:cover;border-radius:4px;background:#111;";
        b.append(v);
      } else {
        const i = document.createElement("div");
        i.textContent = item.kind === "audio" ? "♪" : item.kind === "video" ? "▶" : item.kind === "picture" ? "▧" : "◆";
        i.style.cssText = "display:grid;place-items:center;width:34px;height:34px;border-radius:4px;background:rgba(255,255,255,.08);font:bold 15px sans-serif;";
        b.append(i);
      }
      const texts = document.createElement("div");
      texts.style.minWidth = "0";
      const title = document.createElement("div");
      title.textContent = item.label;
      title.style.cssText = "font-size:11px;font-weight:600;";
      const sub = document.createElement("div");
      sub.textContent = item.source_name || item.input_name;
      sub.style.cssText = "margin-top:2px;font-size:10px;opacity:.55;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
      texts.append(title, sub); b.append(texts);
      b.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        const raw = item.kind === "picture" ? `<Picture ${item.index}>` : item.kind === "video" ? `<Video ${item.index}>` : item.kind === "audio" ? `<Audio ${item.index}>` : `<Asset ${item.index}>`;
        insertRaw(raw);
      });
      menu.append(b);
    }
    menu.style.display = "block";
  }

  visual.addEventListener("keyup", (e) => {
    if (e.key === "Escape") { closeMenu(); return; }
    const info = atQuery();
    if (info) { atRange = info.range; showMenu(info); }
    else if (!activeTagChip) closeMenu();
  });

  document.addEventListener("mousedown", (e) => {
    if (menu.style.display === "none") return;
    if (menu.contains(e.target) || activeTagChip?.contains?.(e.target)) return;
    closeMenu();
  }, true);

  const initial = rawValue();
  source.value = initial;
  refreshAssets();
  render(initial);
  visualBtn.style.background = "rgba(255,255,255,.14)";

  return {
    root,
    setExecutedAssets(list) {
      executedAssets = Array.isArray(list) ? list : [];
      refreshAssets();
      if (mode === "visual") render(rawValue());
    },
    connectionChanged() {
      refreshAssets();
      if (mode === "visual") render(rawValue());
    },
    refreshText() {
      source.value = rawValue();
      if (mode === "visual") render(rawValue());
    }
  };
}

app.registerExtension({
  name: "TerryToolbox.H3PromptEditor",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    const sourceName = String(nodeData?.name || "").toLowerCase();
    if (sourceName.includes("loadimage") || sourceName.includes("loadvideo") || sourceName.includes("loadaudio")) {
      const oldSourceCreated = nodeType.prototype.onNodeCreated;
      nodeType.prototype.onNodeCreated = function() {
        const r = oldSourceCreated?.apply(this, arguments);
        watchSourceNode(this);
        return r;
      };

      const oldSourceConfigure = nodeType.prototype.onConfigure;
      nodeType.prototype.onConfigure = function() {
        const r = oldSourceConfigure?.apply(this, arguments);
        watchSourceNode(this);
        requestLiveAssetRefresh();
        return r;
      };
      return;
    }

    if (nodeData.name !== NODE_ID) return;

    const oldCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function() {
      const r = oldCreated?.apply(this, arguments);
      const editor = createEditor(this);
      this.__terryH3 = editor;
      const w = this.addDOMWidget("terry_h3_editor", "terry_h3_editor", editor.root, {
        serialize: false,
        hideOnZoom: false,
        getMinHeight: () => 400,
        getMaxHeight: () => 850,
      });
      w.serialize = false;
      this.setSize?.([Math.max(this.size?.[0] || 0, 580), Math.max(this.size?.[1] || 0, 535)]);

      const oldExecuted = this.onExecuted;
      this.onExecuted = function(output) {
        oldExecuted?.call(this, output);
        if (Array.isArray(output?.terry_h3_assets)) this.__terryH3?.setExecutedAssets(output.terry_h3_assets);
      };
      return r;
    };

    const oldConn = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function() {
      const r = oldConn?.apply(this, arguments);
      queueMicrotask(() => this.__terryH3?.connectionChanged());
      return r;
    };

    const oldConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function() {
      const r = oldConfigure?.apply(this, arguments);
      queueMicrotask(() => this.__terryH3?.refreshText());
      return r;
    };
  },

  loadedGraphNode(node) {
    if (node?.comfyClass !== NODE_ID && node?.constructor?.type !== NODE_ID) return;
    queueMicrotask(() => {
      node.__terryH3?.refreshText();
      const out = app.nodeOutputs?.[node.id];
      if (Array.isArray(out?.terry_h3_assets)) node.__terryH3?.setExecutedAssets(out.terry_h3_assets);
    });
  }
});
