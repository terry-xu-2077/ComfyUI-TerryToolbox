import { app } from "../../scripts/app.js";

const NODE_ID = "TerryH3ShotTimeline";
const MAX_DURATION = 30;
const MIN_SHOT = 0.5;

function isTarget(node) {
  return [node?.comfyClass, node?.type, node?.constructor?.type, node?.constructor?.nodeData?.name]
    .some((v) => String(v || "") === NODE_ID);
}

function widget(node, name) {
  return node?.widgets?.find((w) => w?.name === name) || null;
}

function isZh() {
  try {
    const raw = app?.ui?.settings?.getSettingValue?.("Comfy.Locale");
    const locale = String(raw || navigator.language || "en").toLowerCase().replace("_", "-");
    return locale === "zh" || locale.startsWith("zh-");
  } catch { return false; }
}

function t(zh, en) { return isZh() ? zh : en; }

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, Number(v) || 0)); }

function normalizeSource(raw) {
  return String(raw || "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[：]/g, ":")
    .replace(/[【［]/g, "[")
    .replace(/[】］]/g, "]")
    .replace(/[，]/g, ",")
    .replace(/\u00A0/g, " ")
    .trim();
}

function parseClock(value) {
  const text = String(value || "").trim();
  let m = text.match(/^(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?$/);
  if (m) {
    const frac = m[3] ? Number(`0.${String(m[3]).padEnd(3, "0")}`) : 0;
    return Number(m[1]) * 60 + Number(m[2]) + frac;
  }
  m = text.match(/^(\d+(?:\.\d+)?)\s*s(?:ec(?:onds?)?)?$/i);
  if (m) return Number(m[1]);
  m = text.match(/^(\d+(?:\.\d+)?)$/);
  return m ? Number(m[1]) : null;
}

function stripSection(source, name, nextNames = []) {
  const all = [name, ...nextNames].map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const head = all.shift();
  const next = all.length ? `(?=\\n\\s*(?:${all.join("|")})\\s*:|$)` : "$";
  const re = new RegExp(`(?:^|\\n)\\s*${head}\\s*:\\s*\\n?([\\s\\S]*?)${next}`, "i");
  const m = source.match(re);
  return m ? String(m[1] || "").trim() : "";
}

function extractDetailed(source) {
  const header = /(?:^|\n)\s*detailed[ _-]*description\s*:\s*/i;
  const m = header.exec(source);
  if (!m) return { body: source, hadHeader: false };
  const start = m.index + m[0].length;
  const tail = source.slice(start);
  const stop = tail.search(/\n\s*(?:overall[ _-]*soundscape|non[ _-]*diegetic[ _-]*music)\s*:/i);
  return { body: (stop >= 0 ? tail.slice(0, stop) : tail).trim(), hadHeader: true };
}

function shotMatches(body) {
  // Tolerates [Shot 1], [shot1], Shot 1:, SHOT-1, and Chinese 镜头 1.
  const re = /(?:\[\s*)?(?:shot|镜头)\s*[-_ ]*\s*(\d+)\s*(?:\])?\s*(?::)?/gi;
  return [...body.matchAll(re)].filter((m) => {
    const before = body.slice(Math.max(0, (m.index || 0) - 1), m.index || 0);
    return !/[A-Za-z0-9_]/.test(before);
  });
}

function consumeLeadingTime(text) {
  let body = String(text || "").trim();
  const patterns = [
    /^at\s+(\d{1,2}:\d{1,2}(?:[.:]\d{1,3})?)\s*[,，]?\s*/i,
    /^(\d{1,2}:\d{1,2}(?:[.:]\d{1,3})?)\s*[,，]\s*/,
    /^at\s+(\d+(?:\.\d+)?)\s*s(?:ec(?:onds?)?)?\s*[,，]?\s*/i,
    /^从\s*(\d+(?:\.\d+)?)\s*秒\s*[,，]?\s*/,
  ];
  for (const re of patterns) {
    const m = body.match(re);
    if (!m) continue;
    const time = parseClock(m[1]);
    if (time != null) return { start: time, text: body.slice(m[0].length).trim() };
  }
  return { start: null, text: body };
}

function parseH3(raw, fallbackTotal = 15) {
  const source = normalizeSource(raw);
  if (!source) throw new Error(t("请先粘贴 H3 提示词。", "Paste an H3 prompt first."));

  const soundscape = stripSection(source, "overall[ _-]*soundscape", ["non[ _-]*diegetic[ _-]*music"]);
  const music = stripSection(source, "non[ _-]*diegetic[ _-]*music");
  const detailed = extractDetailed(source);
  const matches = shotMatches(detailed.body);
  if (!matches.length) throw new Error(t("没有识别到 Shot / 镜头标记。至少需要一个镜头。", "No Shot markers were found. At least one shot is required."));

  const global = detailed.body.slice(0, matches[0].index).trim();
  const shots = [];
  const starts = [];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const begin = (m.index || 0) + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : detailed.body.length;
    const consumed = consumeLeadingTime(detailed.body.slice(begin, end));
    shots.push({ text: consumed.text, duration: 0 });
    starts.push(i === 0 ? 0 : consumed.start);
  }

  const explicit = starts.slice(1).filter((x) => x != null && Number.isFinite(x));
  const maxExplicit = explicit.length ? Math.max(...explicit) : 0;
  let total = clamp(fallbackTotal || 15, 1, MAX_DURATION);
  if (maxExplicit + MIN_SHOT > total) total = Math.min(MAX_DURATION, Math.ceil(maxExplicit + MIN_SHOT));
  if (shots.length * MIN_SHOT > total) total = Math.min(MAX_DURATION, shots.length * MIN_SHOT);

  let warnings = 0;
  let lastKnown = 0;
  for (let i = 1; i < starts.length; i++) {
    if (starts[i] == null || starts[i] <= lastKnown || starts[i] >= total) {
      starts[i] = null;
      warnings += 1;
    } else lastKnown = starts[i];
  }

  // Fill missing start times by evenly distributing between neighboring known anchors.
  let anchor = 0;
  while (anchor < shots.length) {
    let next = anchor + 1;
    while (next < shots.length && starts[next] == null) next += 1;
    const a = starts[anchor] ?? 0;
    const b = next < shots.length ? starts[next] : total;
    const count = next - anchor;
    if (count > 0) {
      const step = Math.max(MIN_SHOT, (b - a) / count);
      for (let j = anchor + 1; j < next; j++) starts[j] = Math.min(total - MIN_SHOT, a + step * (j - anchor));
    }
    anchor = next;
  }

  for (let i = 0; i < shots.length; i++) {
    const a = starts[i] ?? 0;
    const b = i + 1 < shots.length ? (starts[i + 1] ?? total) : total;
    shots[i].duration = Math.max(MIN_SHOT, b - a);
  }

  const sum = shots.reduce((acc, s) => acc + s.duration, 0);
  if (sum > 0 && Math.abs(sum - total) > 0.001) {
    const scale = total / sum;
    for (const shot of shots) shot.duration *= scale;
  }

  return {
    total,
    global,
    shots,
    selected: 0,
    soundEnabled: Boolean(soundscape),
    soundscape,
    musicEnabled: Boolean(music),
    music,
    meta: { warnings, hadDetailedHeader: detailed.hadHeader },
  };
}

function currentTotal(node) {
  try {
    const state = JSON.parse(String(widget(node, "timeline_state")?.value || "{}"));
    if (state?.total) return clamp(state.total, 1, MAX_DURATION);
  } catch {}
  return clamp(widget(node, "duration")?.value || 15, 1, MAX_DURATION) || 15;
}

function applyParsed(node, state) {
  const stateWidget = widget(node, "timeline_state");
  const durationWidget = widget(node, "duration");
  if (!stateWidget) throw new Error(t("找不到时间轴状态输入。", "Timeline state input was not found."));
  const packed = JSON.stringify(state);
  stateWidget.value = packed;
  stateWidget.callback?.(packed);
  if (durationWidget) {
    durationWidget.value = Math.round(state.total);
    durationWidget.callback?.(durationWidget.value);
  }
  node.__terryH3ShotTimeline?.refresh?.();
  node.__terryH3ShotTimeline?.save?.();
  node.setDirtyCanvas?.(true, true);
  app.graph?.change?.();
}

function closeDialog(dialog) {
  dialog?.remove?.();
}

function openParser(node) {
  document.querySelector(".terry-tl-parser-overlay")?.remove?.();
  const overlay = document.createElement("div");
  overlay.className = "terry-tl-parser-overlay";
  const panel = document.createElement("div");
  panel.className = "terry-tl-parser-panel";

  const head = document.createElement("div");
  head.className = "terry-tl-parser-head";
  const title = document.createElement("b");
  title.textContent = t("解析 H3 提示词", "Parse H3 Prompt");
  const close = document.createElement("button");
  close.type = "button"; close.textContent = "×"; close.title = t("关闭", "Close");
  close.addEventListener("click", () => closeDialog(overlay));
  head.append(title, close);

  const hint = document.createElement("div");
  hint.className = "terry-tl-parser-hint";
  hint.textContent = t(
    "粘贴完整 H3 或 detailed_description。可容忍大小写、空格、全角标点、Shot 1:/[Shot1]/镜头1，以及部分时间戳缺失。解析只还原本节点负责的镜头时间轴、全局描述和声音字段。",
    "Paste a full H3 prompt or detailed_description. The parser tolerates casing, spacing, full-width punctuation, Shot 1:/[Shot1]/镜头1, and some missing timestamps. It restores the timeline, global description, and optional sound fields owned by this node."
  );

  const textarea = document.createElement("textarea");
  textarea.className = "terry-tl-parser-text";
  textarea.placeholder = t("在这里粘贴 H3 提示词…", "Paste H3 prompt here…");
  textarea.spellcheck = false;

  const status = document.createElement("div");
  status.className = "terry-tl-parser-status";

  const actions = document.createElement("div");
  actions.className = "terry-tl-parser-actions";
  const cancel = document.createElement("button");
  cancel.type = "button"; cancel.textContent = t("取消", "Cancel");
  cancel.addEventListener("click", () => closeDialog(overlay));
  const parse = document.createElement("button");
  parse.type = "button"; parse.className = "is-primary"; parse.textContent = t("解析并还原", "Parse & Restore");
  parse.addEventListener("click", () => {
    try {
      const state = parseH3(textarea.value, currentTotal(node));
      applyParsed(node, state);
      const warningText = state.meta.warnings
        ? t(` · ${state.meta.warnings} 个时间点已自动容错`, ` · ${state.meta.warnings} time positions were repaired`)
        : "";
      status.className = "terry-tl-parser-status is-ok";
      status.textContent = t(`已还原 ${state.shots.length} 个镜头，总时长 ${state.total.toFixed(1)}s${warningText}`, `Restored ${state.shots.length} shots, total ${state.total.toFixed(1)}s${warningText}`);
      setTimeout(() => closeDialog(overlay), 450);
    } catch (err) {
      status.className = "terry-tl-parser-status is-error";
      status.textContent = String(err?.message || err || t("解析失败", "Parse failed"));
    }
  });
  actions.append(cancel, parse);
  panel.append(head, hint, textarea, status, actions);
  overlay.append(panel);
  overlay.addEventListener("pointerdown", (e) => { if (e.target === overlay) closeDialog(overlay); });
  document.body.append(overlay);
  setTimeout(() => textarea.focus(), 0);
}

function installButton(node) {
  if (!isTarget(node)) return;
  const root = node.__terryH3ShotTimeline?.root || node.__terryH3ShotTimelineRoot;
  const actualRoot = root || document.querySelectorAll(".terry-h3-timeline-root");
  let host = null;
  if (root?.querySelector) host = root.querySelector(".terry-tl-header");
  if (!host) {
    for (const candidate of document.querySelectorAll(".terry-h3-timeline-root")) {
      if (candidate.closest?.(".litegraph") || candidate.isConnected) { host = candidate.querySelector(".terry-tl-header"); if (host) break; }
    }
  }
  if (!host || host.querySelector(".terry-tl-parse-button")) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "terry-tl-parse-button";
  button.textContent = t("解析", "Parse");
  button.title = t("粘贴 H3 提示词并还原时间轴", "Paste an H3 prompt and restore the timeline");
  button.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); openParser(node); });
  host.insertBefore(button, host.children[1] || null);
}

function installStyle() {
  if (document.getElementById("terry-h3-timeline-parser-style")) return;
  const style = document.createElement("style");
  style.id = "terry-h3-timeline-parser-style";
  style.textContent = `
.terry-tl-parse-button{height:24px;padding:0 9px;border:1px solid rgba(255,255,255,.14);border-radius:5px;background:rgba(255,255,255,.07);color:inherit;cursor:pointer;font-size:10px;white-space:nowrap}
.terry-tl-parse-button:hover{background:rgba(255,255,255,.12)}
.terry-tl-parser-overlay{position:fixed;inset:0;z-index:12050;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,.52)}
.terry-tl-parser-panel{width:min(760px,calc(100vw - 48px));max-height:calc(100vh - 48px);display:flex;flex-direction:column;box-sizing:border-box;padding:12px;border:1px solid rgba(255,255,255,.16);border-radius:10px;background:var(--comfy-menu-bg,#202225);color:var(--input-text,#ddd);box-shadow:0 20px 60px rgba(0,0,0,.55);font-family:Inter,system-ui,sans-serif}
.terry-tl-parser-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:7px}.terry-tl-parser-head b{font-size:13px}.terry-tl-parser-head button{width:28px;height:28px;border:0;border-radius:5px;background:rgba(255,255,255,.06);color:inherit;cursor:pointer;font-size:17px}
.terry-tl-parser-hint{margin-bottom:8px;font-size:10px;line-height:1.5;opacity:.58}
.terry-tl-parser-text{width:100%;min-height:320px;resize:vertical;box-sizing:border-box;padding:9px 10px;border:1px solid rgba(255,255,255,.12);border-radius:7px;background:rgba(0,0,0,.20);color:inherit;outline:none;font:11px/1.5 ui-monospace,Consolas,monospace}
.terry-tl-parser-status{min-height:18px;padding-top:6px;font-size:10px;opacity:.72}.terry-tl-parser-status.is-error{color:#ff8e8e;opacity:1}.terry-tl-parser-status.is-ok{color:#8fe3b0;opacity:1}
.terry-tl-parser-actions{display:flex;justify-content:flex-end;gap:7px;margin-top:5px}.terry-tl-parser-actions button{height:29px;padding:0 12px;border:1px solid rgba(255,255,255,.13);border-radius:6px;background:rgba(255,255,255,.06);color:inherit;cursor:pointer;font-size:10px}.terry-tl-parser-actions button.is-primary{background:rgba(255,255,255,.14);font-weight:600}
`;
  document.head.append(style);
}

app.registerExtension({
  name: "TerryToolbox.H3TimelineParser",
  setup() { installStyle(); },
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_ID || nodeType.prototype.__terryTimelineParserInstalled) return;
    nodeType.prototype.__terryTimelineParserInstalled = true;
    for (const hook of ["onNodeCreated", "onAdded", "onConfigure"]) {
      const old = nodeType.prototype[hook];
      nodeType.prototype[hook] = function() {
        const result = old?.apply(this, arguments);
        for (const delay of [0, 60, 180, 500]) setTimeout(() => installButton(this), delay);
        return result;
      };
    }
  },
  loadedGraphNode(node) {
    if (!isTarget(node)) return;
    for (const delay of [0, 100, 350]) setTimeout(() => installButton(node), delay);
  },
});
