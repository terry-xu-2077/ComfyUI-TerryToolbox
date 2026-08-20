import { app } from "../../scripts/app.js";

const NODE_ID = "TerryH3PromptEditor";
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

function nextIndex(node, pattern) {
  let max = 0;
  for (const match of promptText(node).matchAll(pattern)) max = Math.max(max, Number(match[1]) || 0);
  return max + 1;
}

function nextSubject(node) {
  return nextIndex(node, /<Subject\s+(\d+)>/gi);
}

function nextShot(node) {
  return nextIndex(node, /\[Shot\s+(\d+)\]/gi);
}

function nextSpeaker(node) {
  return nextIndex(node, /\(S(\d+)\)/gi);
}

const STATIC_COMMANDS = [
  { category: "结构", label: "subject_definitions", detail: "引用对象定义", kind: "section", raw: "subject_definitions:" },
  { category: "结构", label: "summary", detail: "任务与引用关系摘要", kind: "section", raw: "summary:" },
  { category: "结构", label: "retention_analysis", detail: "引用保留关系分析", kind: "section", raw: "retention_analysis:" },
  { category: "结构", label: "detailed_description", detail: "逐镜头多模态描述", kind: "section", raw: "detailed_description:" },
  { category: "结构", label: "overall_soundscape", detail: "环境与物理声音汇总", kind: "section", raw: "overall_soundscape:" },
  { category: "结构", label: "non_diegetic_music", detail: "非剧情内背景音乐", kind: "section", raw: "non_diegetic_music:" },
  { category: "结构", label: "integrated_multimodal_description", detail: "T2VA / I2VA / FL2VA 基础模式主字段", kind: "section", raw: "integrated_multimodal_description:" },

  { category: "保留关系", label: "fully_preserved", detail: "完整保留视觉引用", kind: "marker", raw: "fully_preserved" },
  { category: "保留关系", label: "partially_preserved", detail: "部分保留视觉引用", kind: "marker", raw: "partially_preserved" },
  { category: "保留关系", label: "attribute_transfer", detail: "属性转移到另一对象", kind: "marker", raw: "attribute_transfer" },
  { category: "保留关系", label: "weak_reference", detail: "弱参考 / 仅保留宽泛相似性", kind: "marker", raw: "weak_reference" },
  { category: "音频关系", label: "fully_copy", detail: "完整复制源音频", kind: "marker", raw: "fully_copy" },
  { category: "音频关系", label: "partially_copy", detail: "部分复制源音频", kind: "marker", raw: "partially_copy" },
  { category: "音频关系", label: "reference", detail: "参考音色 / 节奏 / 内容，不直接复制", kind: "marker", raw: "reference" },

  { category: "时间与连续性", label: "时间戳", detail: "插入 MM:SS.mmm", kind: "time", raw: "00:00.000" },
  { category: "时间与连续性", label: "scenetrans", detail: "对白 / 音频跨镜头连续", kind: "transition", raw: "<scenetrans>" },
  { category: "时间与连续性", label: "cutoff", detail: "对白被视频结尾截断", kind: "cutoff", raw: "<cutoff>" },

  { category: "对白", label: "Dialogue · English", detail: "<d>[English] …</d>", kind: "dialogue", language: "English" },
  { category: "对白", label: "Dialogue · Chinese", detail: "<d>[Chinese] …</d>", kind: "dialogue", language: "Chinese" },
  { category: "对白", label: "Dialogue · Cantonese", detail: "<d>[Cantonese] …</d>", kind: "dialogue", language: "Cantonese" },
  { category: "对白", label: "Dialogue · Japanese", detail: "<d>[Japanese] …</d>", kind: "dialogue", language: "Japanese" },
  { category: "对白", label: "Dialogue · Korean", detail: "<d>[Korean] …</d>", kind: "dialogue", language: "Korean" },
  { category: "对白", label: "Dialogue · Spanish", detail: "<d>[Spanish] …</d>", kind: "dialogue", language: "Spanish" },
  { category: "对白", label: "Dialogue · French", detail: "<d>[French] …</d>", kind: "dialogue", language: "French" },
  { category: "对白", label: "Dialogue · German", detail: "<d>[German] …</d>", kind: "dialogue", language: "German" },

  { category: "Summary 任务类型", label: "reference generation", detail: "[reference generation]", kind: "task", raw: "[reference generation]" },
  { category: "Summary 任务类型", label: "keyframe completion", detail: "[keyframe completion]", kind: "task", raw: "[keyframe completion]" },
  { category: "Summary 任务类型", label: "video editing", detail: "[video editing]", kind: "task", raw: "[video editing]" },
  { category: "Summary 任务类型", label: "video continuation", detail: "[video continuation]", kind: "task", raw: "[video continuation]" },
  { category: "Summary 任务类型", label: "audio reuse", detail: "[audio reuse]", kind: "task", raw: "[audio reuse]" },
  { category: "Summary 任务类型", label: "audio reference", detail: "[audio reference]", kind: "task", raw: "[audio reference]" },

  { category: "镜头运动", label: "Push In", detail: "摄影机前移", kind: "text", raw: "The camera pushes in " },
  { category: "镜头运动", label: "Pull Out", detail: "摄影机后移", kind: "text", raw: "The camera pulls out " },
  { category: "镜头运动", label: "Pan Left", detail: "镜头向左摇", kind: "text", raw: "The camera pans left " },
  { category: "镜头运动", label: "Pan Right", detail: "镜头向右摇", kind: "text", raw: "The camera pans right " },
  { category: "镜头运动", label: "Truck Left", detail: "摄影机向左平移", kind: "text", raw: "The camera trucks left " },
  { category: "镜头运动", label: "Truck Right", detail: "摄影机向右平移", kind: "text", raw: "The camera trucks right " },
  { category: "镜头运动", label: "Tilt Up", detail: "镜头向上仰", kind: "text", raw: "The camera tilts up " },
  { category: "镜头运动", label: "Tilt Down", detail: "镜头向下俯", kind: "text", raw: "The camera tilts down " },
  { category: "镜头运动", label: "Pedestal Up", detail: "摄影机整体上升", kind: "text", raw: "The camera pedals upward " },
  { category: "镜头运动", label: "Pedestal Down", detail: "摄影机整体下降", kind: "text", raw: "The camera pedals downward " },
  { category: "镜头运动", label: "Arc Shot", detail: "环绕弧线运动", kind: "text", raw: "The camera moves in an arc around the subject " },
  { category: "镜头运动", label: "Tracking Shot", detail: "跟随运动主体", kind: "text", raw: "The camera follows the moving subject in a tracking shot " },
  { category: "镜头运动", label: "Static Shot", detail: "固定机位", kind: "text", raw: "The camera holds a static shot " },
  { category: "镜头运动", label: "Zoom In", detail: "变焦拉近", kind: "text", raw: "The camera zooms in " },
  { category: "镜头运动", label: "Zoom Out", detail: "变焦拉远", kind: "text", raw: "The camera zooms out " },
  { category: "镜头运动", label: "POV", detail: "主观视角", kind: "text", raw: "POV, " },
];

function commands(node) {
  const subject = nextSubject(node);
  const shot = nextShot(node);
  const speaker = nextSpeaker(node);
  return [
    { category: "引用", label: `Subject ${subject}`, detail: "自动插入下一个 Subject 编号", kind: "subject", raw: `<Subject ${subject}>` },
    { category: "镜头", label: `Shot ${shot}`, detail: shot === 1 ? "首镜头，无时间戳" : "自动编号并附带时间戳占位", kind: "shot", shot },
    { category: "对白", label: `Speaker S${speaker}`, detail: "自动插入下一个说话人编号", kind: "speaker", raw: `(S${speaker})` },
    ...STATIC_COMMANDS,
  ];
}

function closeMenu(node) {
  node.__terryH3CommandMenu?.remove?.();
  node.__terryH3CommandMenu = null;
  node.__terryH3CommandState = null;
}

function normalizeTriggerAtCaret(editor, event, trigger) {
  if (event.inputType !== "insertText" || event.data !== trigger) return false;
  const selection = window.getSelection?.();
  if (!selection?.rangeCount || !editor.contains(selection.anchorNode)) return false;
  if (selection.anchorNode?.nodeType === Node.TEXT_NODE) return false;
  event.preventDefault();
  const range = selection.getRangeAt(0).cloneRange();
  range.deleteContents();
  const text = document.createTextNode(trigger);
  range.insertNode(text);
  const caret = document.createRange();
  caret.setStart(text, trigger.length);
  caret.collapse(true);
  selection.removeAllRanges();
  selection.addRange(caret);
  return true;
}

function commandRange(editor) {
  const selection = window.getSelection?.();
  if (!selection?.rangeCount || !selection.isCollapsed) return null;
  const caret = selection.getRangeAt(0);
  if (!editor.contains(caret.startContainer) || caret.startContainer.nodeType !== Node.TEXT_NODE) return null;
  const before = String(caret.startContainer.textContent || "").slice(0, caret.startOffset);
  const match = before.match(/\/([^/\n]*)$/);
  if (!match) return null;
  const range = document.createRange();
  range.setStart(caret.startContainer, caret.startOffset - match[0].length);
  range.setEnd(caret.startContainer, caret.startOffset);
  return { range, query: match[1].trim().toLowerCase() };
}

function chip(raw, text, className = "") {
  const element = document.createElement("span");
  element.className = `terry-h3-chip ${className}`;
  element.contentEditable = "false";
  element.dataset.raw = raw;
  element.textContent = text;
  return element;
}

function visualNodesForCommand(command) {
  const fragment = document.createDocumentFragment();
  const addSpace = () => fragment.append(document.createTextNode(CARET));
  if (command.kind === "section") fragment.append(chip(command.raw, command.label.replaceAll("_", " "), "terry-h3-strong"));
  else if (command.kind === "marker") fragment.append(chip(command.raw, command.raw.replaceAll("_", " ")));
  else if (command.kind === "subject") fragment.append(chip(command.raw, `◇ ${command.label}`, "terry-h3-strong"));
  else if (command.kind === "speaker") fragment.append(chip(command.raw, `🎙 ${command.raw.slice(1, -1)}`));
  else if (command.kind === "time") fragment.append(chip(command.raw, `⏱ ${command.raw}`));
  else if (command.kind === "transition") fragment.append(chip(command.raw, "↪ scene transition"));
  else if (command.kind === "cutoff") fragment.append(chip(command.raw, "✂ cutoff"));
  else if (command.kind === "task") fragment.append(chip(command.raw, command.raw.slice(1, -1), "terry-h3-strong"));
  else if (command.kind === "dialogue") {
    const raw = `<d>[${command.language}] </d>`;
    fragment.append(chip(raw, `[${command.language}] …`, "terry-h3-dialogue"));
  } else if (command.kind === "shot") {
    const shotRaw = `[Shot ${command.shot}]`;
    fragment.append(chip(shotRaw, `🎬 Shot ${command.shot}`, "terry-h3-strong"));
    if (command.shot > 1) {
      fragment.append(document.createTextNode(" At "));
      fragment.append(chip("00:00.000", "⏱ 00:00.000"));
      fragment.append(document.createTextNode(", "));
    } else fragment.append(document.createTextNode(" "));
  } else fragment.append(document.createTextNode(command.raw || ""));
  addSpace();
  return fragment;
}

function choose(node, command) {
  const state = node.__terryH3CommandState;
  const editor = node.__terryH3Editor;
  if (!state?.range || !editor) return;
  state.range.deleteContents();
  const fragment = visualNodesForCommand(command);
  const marker = document.createTextNode(CARET);
  fragment.append(marker);
  state.range.insertNode(fragment);
  const selection = window.getSelection?.();
  if (selection) {
    const caret = document.createRange();
    caret.setStart(marker, marker.textContent.length);
    caret.collapse(true);
    selection.removeAllRanges();
    selection.addRange(caret);
  }
  closeMenu(node);
  editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: null }));
  editor.focus({ preventScroll: true });
}

function renderMenu(node) {
  const state = node.__terryH3CommandState;
  if (!state) return;
  const { menu, options } = state;
  menu.replaceChildren();
  const head = document.createElement("div");
  head.className = "terry-h3-command-head";
  head.innerHTML = `<b>H3 语法</b><span>/ + 关键词筛选</span>`;
  menu.append(head);
  if (!options.length) {
    const empty = document.createElement("div");
    empty.className = "terry-h3-command-empty";
    empty.textContent = "没有匹配的 H3 语法";
    menu.append(empty);
    return;
  }
  options.forEach((command, index) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `terry-h3-command-item${index === state.active ? " is-active" : ""}`;
    const category = document.createElement("span");
    category.className = "terry-h3-command-category";
    category.textContent = command.category;
    const text = document.createElement("span");
    text.className = "terry-h3-command-text";
    const title = document.createElement("b");
    title.textContent = command.label;
    const detail = document.createElement("small");
    detail.textContent = command.detail || command.raw || "";
    text.append(title, detail);
    item.append(category, text);
    item.addEventListener("pointermove", () => {
      if (!node.__terryH3CommandState || state.active === index) return;
      state.active = index;
      renderMenu(node);
    });
    item.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      choose(node, command);
    });
    menu.append(item);
  });
}

function positionMenu(menu, editor) {
  const selection = window.getSelection?.();
  const caret = selection?.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : null;
  const rect = caret && (caret.width || caret.height) ? caret : editor.getBoundingClientRect();
  const width = 330;
  const height = Math.min(420, menu.offsetHeight || 320);
  let left = rect.left;
  let top = rect.bottom + 6;
  if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
  if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 6);
  menu.style.left = `${Math.max(8, Math.round(left))}px`;
  menu.style.top = `${Math.max(8, Math.round(top))}px`;
}

function openMenu(node) {
  if (node?.properties?.[VIEW_PROP] === "raw") {
    closeMenu(node);
    return false;
  }
  const editor = node.__terryH3Editor;
  const hit = commandRange(editor);
  if (!hit) {
    closeMenu(node);
    return false;
  }
  const all = commands(node);
  const options = all.filter((command) => {
    if (!hit.query) return true;
    const haystack = `${command.label} ${command.category} ${command.detail || ""} ${command.raw || ""}`.toLowerCase();
    return haystack.includes(hit.query);
  });
  let state = node.__terryH3CommandState;
  if (!state) {
    const menu = document.createElement("div");
    menu.className = "terry-h3-command-menu";
    document.body.append(menu);
    state = node.__terryH3CommandState = { menu, range: hit.range, options, active: 0 };
    node.__terryH3CommandMenu = menu;
  } else {
    state.range = hit.range;
    state.options = options;
    state.active = Math.min(state.active, Math.max(0, options.length - 1));
  }
  renderMenu(node);
  positionMenu(state.menu, editor);
  return true;
}

function handleCommandKeys(node, event) {
  const state = node.__terryH3CommandState;
  if (!state) return false;
  if (event.key === "Escape") {
    closeMenu(node);
    return true;
  }
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    if (state.options.length) {
      const delta = event.key === "ArrowDown" ? 1 : -1;
      state.active = (state.active + delta + state.options.length) % state.options.length;
      renderMenu(node);
      state.menu.querySelector(".is-active")?.scrollIntoView?.({ block: "nearest" });
    }
    return true;
  }
  if (event.key === "Enter" || event.key === "Tab") {
    const command = state.options[state.active];
    if (command) choose(node, command);
    return Boolean(command);
  }
  return false;
}

function syncBooleanView(node) {
  const toggle = widget(node, "visual_preview");
  const button = node.__terryH3ViewButton;
  if (!toggle || !button) return;
  const wantVisual = Boolean(toggle.value);
  const isVisual = node?.properties?.[VIEW_PROP] !== "raw";
  if (wantVisual !== isVisual) button.click();
  button.style.display = "none";
}

function bindToggle(node) {
  const toggle = widget(node, "visual_preview");
  if (!toggle || toggle.__terryH3Bound) return;
  toggle.__terryH3Bound = true;
  const original = toggle.callback;
  toggle.callback = function(value) {
    const result = original?.apply(this, arguments);
    toggle.value = Boolean(value);
    setTimeout(() => syncBooleanView(node), 0);
    return result;
  };
}

function bindEditor(node) {
  const editor = node.__terryH3Editor;
  if (!editor || editor.__terryH3CommandsBound) return false;
  editor.__terryH3CommandsBound = true;
  editor.dataset.placeholder = "粘贴 MiniMax H3；@ 引用素材；/ 插入 H3 语法…";
  editor.addEventListener("beforeinput", (event) => {
    if (node?.properties?.[VIEW_PROP] === "raw") return;
    const normalized = normalizeTriggerAtCaret(editor, event, "/");
    if (normalized || (event.inputType === "insertText" && event.data === "/")) setTimeout(() => openMenu(node), 0);
  }, true);
  editor.addEventListener("input", () => {
    if (node?.properties?.[VIEW_PROP] !== "raw") queueMicrotask(() => openMenu(node));
    else closeMenu(node);
  });
  editor.addEventListener("keyup", (event) => {
    if (!["ArrowUp", "ArrowDown", "Enter", "Tab", "Escape"].includes(event.key)) openMenu(node);
  });
  editor.addEventListener("keydown", (event) => {
    if (!handleCommandKeys(node, event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  }, true);
  editor.addEventListener("blur", () => setTimeout(() => {
    if (!node.__terryH3CommandMenu?.matches?.(":hover")) closeMenu(node);
  }, 150));
  bindToggle(node);
  syncBooleanView(node);
  return true;
}

function installSoon(node) {
  if (!isTarget(node)) return;
  bindToggle(node);
  if (bindEditor(node)) return;
  let attempts = 0;
  const retry = () => {
    attempts += 1;
    bindToggle(node);
    if (bindEditor(node) || attempts >= 12) return;
    setTimeout(retry, Math.min(1000, 60 * attempts));
  };
  setTimeout(retry, 0);
}

function installStyle() {
  if (document.getElementById("terry-h3-command-style")) return;
  const style = document.createElement("style");
  style.id = "terry-h3-command-style";
  style.textContent = `
.terry-h3-view{display:none!important}
.terry-h3-command-menu{position:fixed;z-index:10090;width:330px;max-height:420px;overflow:auto;padding:5px;border:1px solid rgba(255,255,255,.15);border-radius:9px;background:var(--comfy-menu-bg,#202225);box-shadow:0 16px 38px rgba(0,0,0,.46);color:var(--input-text,#ddd)}
.terry-h3-command-head{position:sticky;top:-5px;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 9px;border-bottom:1px solid rgba(255,255,255,.09);background:var(--comfy-menu-bg,#202225);font:12px/1.3 system-ui,sans-serif}
.terry-h3-command-head span{font-size:10px;opacity:.48}
.terry-h3-command-item{display:grid;grid-template-columns:72px minmax(0,1fr);gap:8px;align-items:center;width:100%;min-height:43px;padding:5px 7px;border:0;border-radius:6px;background:transparent;color:inherit;text-align:left;cursor:pointer}
.terry-h3-command-item:hover,.terry-h3-command-item.is-active{background:rgba(255,255,255,.09)}
.terry-h3-command-category{display:inline-flex;align-items:center;justify-content:center;min-height:22px;padding:2px 5px;border-radius:4px;background:rgba(255,255,255,.07);font:10px/1.2 system-ui,sans-serif;opacity:.72}
.terry-h3-command-text{min-width:0}.terry-h3-command-text b,.terry-h3-command-text small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.terry-h3-command-text b{font:600 12px/1.3 Consolas,monospace}.terry-h3-command-text small{margin-top:3px;font:10px/1.25 system-ui,sans-serif;opacity:.52}
.terry-h3-command-empty{padding:12px;font:11px/1.4 system-ui,sans-serif;opacity:.62}
`;
  document.head.append(style);
}

app.registerExtension({
  name: "TerryToolbox.H3PromptCommands",
  setup() {
    installStyle();
    document.addEventListener("pointerdown", (event) => {
      for (const node of app.graph?._nodes || []) {
        if (!isTarget(node) || !node.__terryH3CommandMenu) continue;
        if (node.__terryH3CommandMenu.contains(event.target) || node.__terryH3Wrap?.contains?.(event.target)) continue;
        closeMenu(node);
      }
    }, true);
  },
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_ID || nodeType.prototype.__terryH3CommandsInstalled) return;
    nodeType.prototype.__terryH3CommandsInstalled = true;
    const created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function() {
      const result = created?.apply(this, arguments);
      installSoon(this);
      return result;
    };
    const added = nodeType.prototype.onAdded;
    nodeType.prototype.onAdded = function() {
      const result = added?.apply(this, arguments);
      installSoon(this);
      return result;
    };
    const configured = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function() {
      const result = configured?.apply(this, arguments);
      installSoon(this);
      return result;
    };
    const draw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function() {
      const result = draw?.apply(this, arguments);
      if (this.__terryH3Editor) {
        bindToggle(this);
        bindEditor(this);
        syncBooleanView(this);
      }
      return result;
    };
  },
  loadedGraphNode(node) {
    installSoon(node);
  },
});
