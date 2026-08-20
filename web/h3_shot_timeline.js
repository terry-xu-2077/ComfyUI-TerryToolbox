import { app } from "../../scripts/app.js";

const NODE_ID = "TerryH3ShotTimeline";
const MIN_SHOT = 0.5;
const MAX_DURATION = 30;

function isTarget(node) {
  return [node?.comfyClass, node?.type, node?.constructor?.type, node?.constructor?.nodeData?.name]
    .some((v) => String(v || "") === NODE_ID);
}

function widget(node, name) {
  return node?.widgets?.find((w) => w?.name === name) || null;
}

function hideWidget(w) {
  if (!w || w.__terryTimelineHidden) return;
  w.__terryTimelineHidden = true;
  w.hidden = true;
  w.type = "hidden";
  w.options ||= {};
  w.options.hidden = true;
  w.computeSize = () => [0, -4];
  if (w.element?.style) w.element.style.display = "none";
  if (w.inputEl?.style) w.inputEl.style.display = "none";
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

function t(zh, en) {
  return localeIsZh() ? zh : en;
}

function formatTime(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(value / 60);
  const sec = value - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${sec.toFixed(3).padStart(6, "0")}`;
}

function parseTime(text) {
  const m = String(text || "").match(/^(\d{1,2}):(\d{2})\.(\d{3})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 1000;
}

function cleanDescriptionText(text) {
  return String(text || "").replace(/\r\n?/g, "\n").trim();
}

function normalizeDurations(shots, total) {
  total = Math.max(1, Math.min(MAX_DURATION, Number(total) || 15));
  if (!shots.length) shots.push({ text: "", duration: total });

  for (const shot of shots) shot.duration = Math.max(MIN_SHOT, Number(shot.duration) || MIN_SHOT);
  let sum = shots.reduce((acc, s) => acc + s.duration, 0);

  if (sum <= 0) {
    const each = total / shots.length;
    for (const shot of shots) shot.duration = each;
    return;
  }

  const scale = total / sum;
  for (const shot of shots) shot.duration *= scale;

  // If scaling pushed tiny clips under the minimum, fix them while preserving total.
  for (let pass = 0; pass < 4; pass++) {
    let deficit = 0;
    let flexible = 0;
    for (const shot of shots) {
      if (shot.duration < MIN_SHOT) {
        deficit += MIN_SHOT - shot.duration;
        shot.duration = MIN_SHOT;
      } else flexible += Math.max(0, shot.duration - MIN_SHOT);
    }
    if (deficit <= 1e-6 || flexible <= 1e-6) break;
    for (const shot of shots) {
      const room = Math.max(0, shot.duration - MIN_SHOT);
      if (!room) continue;
      shot.duration -= deficit * (room / flexible);
    }
  }

  sum = shots.reduce((acc, s) => acc + s.duration, 0);
  const delta = total - sum;
  shots[shots.length - 1].duration = Math.max(MIN_SHOT, shots[shots.length - 1].duration + delta);
}

function parseDetailedDescription(raw, total) {
  const source = cleanDescriptionText(raw).replace(/^detailed_description:\s*/i, "");
  const re = /\[Shot\s+(\d+)\]/gi;
  const matches = [...source.matchAll(re)];

  if (!matches.length) {
    return {
      intro: source,
      shots: [{ text: "", duration: total }],
    };
  }

  const intro = source.slice(0, matches[0].index).trim();
  const starts = [];
  const shots = [];

  matches.forEach((m, i) => {
    const begin = m.index + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : source.length;
    let body = source.slice(begin, end).trim();
    let start = i === 0 ? 0 : null;
    const tm = body.match(/^At\s+(\d{1,2}:\d{2}\.\d{3})\s*,\s*/i);
    if (tm) {
      start = parseTime(tm[1]);
      body = body.slice(tm[0].length).trim();
    }
    starts.push(start);
    shots.push({ text: body, duration: 0 });
  });

  let valid = true;
  for (let i = 1; i < starts.length; i++) {
    if (starts[i] == null || starts[i] <= (starts[i - 1] ?? 0)) { valid = false; break; }
  }

  if (valid) {
    for (let i = 0; i < shots.length; i++) {
      const a = starts[i] ?? 0;
      const b = i + 1 < shots.length ? starts[i + 1] : total;
      shots[i].duration = Math.max(MIN_SHOT, b - a);
    }
  } else {
    const each = total / shots.length;
    for (const shot of shots) shot.duration = each;
  }

  normalizeDurations(shots, total);
  return { intro, shots };
}

function compileDetailedDescription(state) {
  const parts = ["detailed_description:"];
  const intro = cleanDescriptionText(state.intro);
  if (intro) parts.push(intro);

  let cursor = 0;
  state.shots.forEach((shot, index) => {
    const text = cleanDescriptionText(shot.text);
    if (index === 0) parts.push(`[Shot 1]${text ? ` ${text}` : ""}`);
    else parts.push(`[Shot ${index + 1}] At ${formatTime(cursor)},${text ? ` ${text}` : ""}`);
    cursor += shot.duration;
  });
  return parts.join("\n");
}

function parseSavedState(raw, fallbackText, fallbackDuration) {
  try {
    if (raw) {
      const data = JSON.parse(raw);
      if (data && Array.isArray(data.shots)) {
        const total = Math.max(1, Math.min(MAX_DURATION, Number(data.total) || fallbackDuration || 15));
        const state = {
          total,
          intro: String(data.intro || ""),
          shots: data.shots.map((s) => ({ text: String(s?.text || ""), duration: Number(s?.duration) || MIN_SHOT })),
          selected: Math.max(0, Number(data.selected) || 0),
        };
        normalizeDurations(state.shots, total);
        return state;
      }
    }
  } catch {}

  const total = Math.max(1, Math.min(MAX_DURATION, Number(fallbackDuration) || 15));
  const parsed = parseDetailedDescription(fallbackText, total);
  return { total, intro: parsed.intro, shots: parsed.shots, selected: 0 };
}

function createEditor(node) {
  const textWidget = widget(node, "detailed_description");
  const durationWidget = widget(node, "duration");
  const stateWidget = widget(node, "timeline_state");
  hideWidget(textWidget);
  hideWidget(durationWidget);
  hideWidget(stateWidget);

  let state = parseSavedState(stateWidget?.value, textWidget?.value, durationWidget?.value);
  let dragging = null;

  const root = document.createElement("div");
  root.className = "terry-h3-timeline-root";
  root.style.cssText = "width:100%;box-sizing:border-box;padding:6px;font-family:Inter,system-ui,sans-serif;color:var(--input-text,#ddd);";

  const header = document.createElement("div");
  header.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:8px;";
  const title = document.createElement("div");
  title.textContent = t("detailed_description 镜头时间轴", "detailed_description Shot Timeline");
  title.style.cssText = "font-size:12px;font-weight:700;flex:1;";
  const durationLabel = document.createElement("span");
  durationLabel.style.cssText = "font-size:10px;opacity:.65;white-space:nowrap;";
  const durationRange = document.createElement("input");
  durationRange.type = "range";
  durationRange.min = "1";
  durationRange.max = String(MAX_DURATION);
  durationRange.step = "1";
  durationRange.style.cssText = "width:120px;";
  const durationNumber = document.createElement("input");
  durationNumber.type = "number";
  durationNumber.min = "1";
  durationNumber.max = String(MAX_DURATION);
  durationNumber.step = "1";
  durationNumber.style.cssText = "width:50px;height:24px;box-sizing:border-box;border:1px solid rgba(255,255,255,.12);border-radius:5px;background:rgba(0,0,0,.18);color:inherit;text-align:center;font-size:11px;";
  header.append(title, durationLabel, durationRange, durationNumber);

  const introWrap = document.createElement("div");
  introWrap.style.cssText = "margin-bottom:8px;";
  const introLabel = document.createElement("div");
  introLabel.textContent = t("整体描述（可选）", "Overall description (optional)");
  introLabel.style.cssText = "margin-bottom:4px;font-size:10px;opacity:.62;";
  const intro = document.createElement("textarea");
  intro.rows = 2;
  intro.placeholder = t("例如：写实多机位情景喜剧风格，室内暖光。", "Example: realistic multi-camera sitcom style with warm indoor lighting.");
  intro.style.cssText = "width:100%;resize:vertical;box-sizing:border-box;padding:7px 8px;border:1px solid rgba(255,255,255,.11);border-radius:6px;background:rgba(0,0,0,.16);color:inherit;font:11px/1.45 ui-monospace,Consolas,monospace;outline:none;";
  introWrap.append(introLabel, intro);

  const laneHeader = document.createElement("div");
  laneHeader.style.cssText = "display:flex;align-items:center;justify-content:space-between;margin:2px 0 4px;";
  const laneTitle = document.createElement("span");
  laneTitle.textContent = t("镜头", "Shots");
  laneTitle.style.cssText = "font-size:10px;opacity:.62;";
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.textContent = t("+ 镜头", "+ Shot");
  addBtn.style.cssText = "height:25px;padding:0 9px;border:1px solid rgba(255,255,255,.12);border-radius:5px;background:rgba(255,255,255,.07);color:inherit;cursor:pointer;font-size:10px;";
  laneHeader.append(laneTitle, addBtn);

  const lane = document.createElement("div");
  lane.style.cssText = "position:relative;display:flex;width:100%;height:58px;overflow:hidden;border:1px solid rgba(255,255,255,.12);border-radius:7px;background:rgba(0,0,0,.20);user-select:none;touch-action:none;";

  const cards = document.createElement("div");
  cards.style.cssText = "display:flex;flex-direction:column;gap:6px;margin-top:8px;";

  const footer = document.createElement("div");
  footer.style.cssText = "display:flex;justify-content:space-between;margin-top:6px;font-size:9px;opacity:.48;";
  const help = document.createElement("span");
  help.textContent = t("拖动镜头接缝调整时长 · 总时长固定", "Drag seams to change shot length · total duration stays fixed");
  const status = document.createElement("span");
  footer.append(help, status);

  root.append(header, introWrap, laneHeader, lane, cards, footer);

  function save() {
    state.total = Math.max(1, Math.min(MAX_DURATION, Number(state.total) || 15));
    normalizeDurations(state.shots, state.total);
    const compiled = compileDetailedDescription(state);
    if (textWidget) {
      textWidget.value = compiled;
      textWidget.callback?.(compiled);
    }
    if (durationWidget) {
      durationWidget.value = Math.round(state.total);
      durationWidget.callback?.(durationWidget.value);
    }
    if (stateWidget) {
      const packed = JSON.stringify({ total: state.total, intro: state.intro, shots: state.shots, selected: state.selected });
      stateWidget.value = packed;
      stateWidget.callback?.(packed);
    }
    status.textContent = `${state.shots.length} ${t("镜头", "shots")} · ${state.total.toFixed(1)}s`;
    node.setDirtyCanvas?.(true, true);
  }

  function setTotal(next) {
    next = Math.max(1, Math.min(MAX_DURATION, Number(next) || 15));
    const old = state.total || next;
    const scale = next / old;
    for (const shot of state.shots) shot.duration *= scale;
    state.total = next;
    normalizeDurations(state.shots, next);
    render();
    save();
  }

  durationRange.addEventListener("input", () => setTotal(durationRange.value));
  durationNumber.addEventListener("change", () => setTotal(durationNumber.value));
  intro.addEventListener("input", () => { state.intro = intro.value; save(); });

  addBtn.addEventListener("click", () => {
    const index = Math.max(0, Math.min(state.shots.length - 1, state.selected || 0));
    const base = state.shots[index];
    if (!base || base.duration < MIN_SHOT * 2) return;
    const half = base.duration / 2;
    base.duration = half;
    state.shots.splice(index + 1, 0, { text: "", duration: half });
    state.selected = index + 1;
    render();
    save();
  });

  function deleteShot(index) {
    if (state.shots.length <= 1) return;
    const removed = state.shots[index];
    if (index > 0) state.shots[index - 1].duration += removed.duration;
    else state.shots[1].duration += removed.duration;
    state.shots.splice(index, 1);
    state.selected = Math.max(0, Math.min(state.shots.length - 1, index - 1));
    render();
    save();
  }

  function renderLane() {
    lane.replaceChildren();
    let cursor = 0;
    state.shots.forEach((shot, index) => {
      const block = document.createElement("button");
      block.type = "button";
      block.style.cssText = `position:relative;flex:0 0 ${(shot.duration / state.total) * 100}%;min-width:0;border:0;border-right:${index < state.shots.length - 1 ? "1px solid rgba(255,255,255,.14)" : "0"};background:${index === state.selected ? "rgba(255,255,255,.14)" : "rgba(255,255,255,.055)"};color:inherit;cursor:pointer;overflow:hidden;`;
      const label = document.createElement("span");
      label.textContent = `Shot ${index + 1}`;
      label.style.cssText = "display:block;font-size:10px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
      const dur = document.createElement("span");
      dur.textContent = `${shot.duration.toFixed(1)}s`;
      dur.style.cssText = "display:block;margin-top:3px;font-size:9px;opacity:.6;";
      block.append(label, dur);
      block.addEventListener("click", () => { state.selected = index; renderLane(); renderCards(); save(); });
      lane.append(block);

      cursor += shot.duration;
      if (index < state.shots.length - 1) {
        const handle = document.createElement("div");
        handle.title = t("拖动调整镜头分界", "Drag to move shot boundary");
        handle.style.cssText = `position:absolute;z-index:5;left:calc(${(cursor / state.total) * 100}% - 5px);top:0;width:10px;height:100%;cursor:ew-resize;`;
        const line = document.createElement("div");
        line.style.cssText = "position:absolute;left:4px;top:8px;bottom:8px;width:2px;border-radius:2px;background:rgba(255,255,255,.65);box-shadow:0 0 0 1px rgba(0,0,0,.25);";
        handle.append(line);
        handle.addEventListener("pointerdown", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          dragging = {
            index,
            startX: ev.clientX,
            left: state.shots[index].duration,
            right: state.shots[index + 1].duration,
          };
          handle.setPointerCapture?.(ev.pointerId);
        });
        handle.addEventListener("pointermove", (ev) => {
          if (!dragging || dragging.index !== index) return;
          const rect = lane.getBoundingClientRect();
          if (!rect.width) return;
          const delta = ((ev.clientX - dragging.startX) / rect.width) * state.total;
          const pair = dragging.left + dragging.right;
          let left = Math.round((dragging.left + delta) * 10) / 10;
          left = Math.max(MIN_SHOT, Math.min(pair - MIN_SHOT, left));
          state.shots[index].duration = left;
          state.shots[index + 1].duration = pair - left;
          renderLane();
          renderCards();
          save();
        });
        handle.addEventListener("pointerup", () => { dragging = null; });
        handle.addEventListener("pointercancel", () => { dragging = null; });
        lane.append(handle);
      }
    });
  }

  function renderCards() {
    cards.replaceChildren();
    let cursor = 0;
    state.shots.forEach((shot, index) => {
      const row = document.createElement("div");
      row.style.cssText = `display:grid;grid-template-columns:88px minmax(0,1fr) 28px;gap:6px;align-items:start;padding:6px;border:1px solid ${index === state.selected ? "rgba(255,255,255,.20)" : "rgba(255,255,255,.09)"};border-radius:6px;background:${index === state.selected ? "rgba(255,255,255,.055)" : "rgba(0,0,0,.10)"};`;

      const meta = document.createElement("button");
      meta.type = "button";
      meta.style.cssText = "border:0;background:transparent;color:inherit;text-align:left;cursor:pointer;padding:2px;";
      const n = document.createElement("b");
      n.textContent = `Shot ${index + 1}`;
      n.style.cssText = "display:block;font-size:10px;";
      const time = document.createElement("span");
      time.textContent = `${formatTime(cursor)}\n${shot.duration.toFixed(1)}s`;
      time.style.cssText = "display:block;margin-top:3px;font-size:9px;line-height:1.35;opacity:.56;white-space:pre-line;";
      meta.append(n, time);
      meta.addEventListener("click", () => { state.selected = index; renderLane(); renderCards(); save(); });

      const text = document.createElement("textarea");
      text.rows = 3;
      text.value = shot.text;
      text.placeholder = t("输入这一镜头的 detailed_description…", "Write this shot's detailed_description…");
      text.style.cssText = "width:100%;resize:vertical;box-sizing:border-box;padding:6px 7px;border:1px solid rgba(255,255,255,.09);border-radius:5px;background:rgba(0,0,0,.15);color:inherit;font:10.5px/1.45 ui-monospace,Consolas,monospace;outline:none;";
      text.addEventListener("focus", () => { state.selected = index; renderLane(); });
      text.addEventListener("input", () => { shot.text = text.value; save(); });

      const del = document.createElement("button");
      del.type = "button";
      del.textContent = "×";
      del.title = t("删除镜头", "Delete shot");
      del.disabled = state.shots.length <= 1;
      del.style.cssText = "width:26px;height:26px;border:1px solid rgba(255,255,255,.10);border-radius:5px;background:rgba(255,255,255,.05);color:inherit;cursor:pointer;font-size:15px;opacity:.7;";
      del.addEventListener("click", () => deleteShot(index));

      row.append(meta, text, del);
      cards.append(row);
      cursor += shot.duration;
    });
  }

  function render() {
    durationRange.value = String(Math.round(state.total));
    durationNumber.value = String(Math.round(state.total));
    durationLabel.textContent = `${t("总时长", "Total")} ${state.total.toFixed(0)}s / ${MAX_DURATION}s`;
    if (intro.value !== state.intro) intro.value = state.intro;
    renderLane();
    renderCards();
    status.textContent = `${state.shots.length} ${t("镜头", "shots")} · ${state.total.toFixed(1)}s`;
  }

  render();
  save();

  return {
    root,
    refresh() {
      const next = parseSavedState(stateWidget?.value, textWidget?.value, durationWidget?.value);
      state = next;
      render();
    },
  };
}

app.registerExtension({
  name: "TerryToolbox.H3ShotTimeline",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_ID || nodeType.prototype.__terryH3TimelineInstalled) return;
    nodeType.prototype.__terryH3TimelineInstalled = true;

    const created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function() {
      const result = created?.apply(this, arguments);
      const editor = createEditor(this);
      this.__terryH3ShotTimeline = editor;
      const dom = this.addDOMWidget("terry_h3_shot_timeline", "terry_h3_shot_timeline", editor.root, {
        serialize: false,
        hideOnZoom: false,
        getMinHeight: () => 420,
        getMaxHeight: () => 900,
      });
      dom.serialize = false;
      this.setSize?.([Math.max(620, this.size?.[0] || 0), Math.max(520, this.size?.[1] || 0)]);
      return result;
    };

    const configure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function() {
      const result = configure?.apply(this, arguments);
      setTimeout(() => this.__terryH3ShotTimeline?.refresh?.(), 0);
      return result;
    };
  },

  loadedGraphNode(node) {
    if (!isTarget(node)) return;
    setTimeout(() => node.__terryH3ShotTimeline?.refresh?.(), 0);
  },
});
