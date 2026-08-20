import { app } from "../../scripts/app.js";

const NODE_ID = "TerryH3PromptEditor";
const VIEW_PROP = "terry_h3_view_mode";
const CARET = "\u200B";
const LANGUAGES = [
  "English", "Chinese", "Cantonese", "Japanese", "Korean", "Spanish", "French",
  "German", "Italian", "Portuguese", "Russian", "Arabic", "Hindi", "Thai",
  "Vietnamese", "Indonesian", "Turkish", "Polish", "Dutch", "Other",
];

const CATEGORY_META = [
  { id: "structure", label: "结构", icon: "§", detail: "H3 主字段与段落" },
  { id: "shot", label: "镜头", icon: "🎬", detail: "Shot、时间戳与说话人" },
  { id: "dialogue", label: "对白", icon: "💬", detail: "可编辑对白块与连续性" },
  { id: "retention", label: "保留关系", icon: "◎", detail: "视觉与音频引用关系" },
  { id: "task", label: "任务类型", icon: "▣", detail: "Summary 的任务类型前缀" },
  { id: "camera", label: "镜头运动", icon: "◉", detail: "Camera motion 常用表达" },
];

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

function nextShot(node) { return nextIndex(node, /\[Shot\s+(\d+)\]/gi); }
function nextSpeaker(node) { return nextIndex(node, /\(S(\d+)\)/gi); }

function commands(node) {
  const shot = nextShot(node);
  const speaker = nextSpeaker(node);
  return [
    { category: "structure", label: "subject_definitions", detail: "定义 Subject / Picture / Video / Audio 的引用角色", kind: "section", raw: "subject_definitions:" },
    { category: "structure", label: "summary", detail: "任务类型与主要引用关系摘要", kind: "section", raw: "summary:" },
    { category: "structure", label: "retention_analysis", detail: "逐项说明引用内容如何被保留或迁移", kind: "section", raw: "retention_analysis:" },
    { category: "structure", label: "detailed_description", detail: "Full-reference 模式逐镜头主体", kind: "section", raw: "detailed_description:" },
    { category: "structure", label: "integrated_multimodal_description", detail: "T2VA / I2VA / FL2VA / L2VA 主字段", kind: "section", raw: "integrated_multimodal_description:" },
    { category: "structure", label: "overall_soundscape", detail: "环境声、动作声与非语言人声汇总", kind: "section", raw: "overall_soundscape:" },
    { category: "structure", label: "non_diegetic_music", detail: "仅观众可听见的非剧情内音乐", kind: "section", raw: "non_diegetic_music:" },

    { category: "shot", label: `Shot ${shot}`, detail: shot === 1 ? "首镜头，无时间戳" : "自动使用下一个 Shot 编号", kind: "shot", shot },
    { category: "shot", label: "时间戳", detail: "插入 MM:SS.mmm 占位", kind: "time", raw: "00:00.000" },
    { category: "shot", label: `Speaker S${speaker}`, detail: "插入下一个全局说话人编号", kind: "speaker", raw: `(S${speaker})` },

    { category: "dialogue", label: "对白块", detail: "语言下拉 + 可直接编辑正文，输出 <d>[Language] ...</d>", kind: "dialogue", language: "English" },
    { category: "dialogue", label: "scenetrans", detail: "对白或音频跨镜头连续", kind: "transition", raw: "<scenetrans>" },
    { category: "dialogue", label: "cutoff", detail: "对白被视频结尾截断", kind: "cutoff", raw: "<cutoff>" },

    { category: "retention", label: "fully_preserved", detail: "定义的视觉引用角色被完整保留", kind: "marker", raw: "fully_preserved" },
    { category: "retention", label: "partially_preserved", detail: "仍使用引用内容，但部分特征被改变", kind: "marker", raw: "partially_preserved" },
    { category: "retention", label: "attribute_transfer", detail: "把引用特征迁移到另一个可识别主体", kind: "marker", raw: "attribute_transfer" },
    { category: "retention", label: "weak_reference", detail: "仅保留宽泛风格、类别、构图或氛围", kind: "marker", raw: "weak_reference" },
    { category: "retention", label: "fully_copy", detail: "完整复制源音频信号", kind: "marker", raw: "fully_copy" },
    { category: "retention", label: "partially_copy", detail: "只复制部分时间或音频层", kind: "marker", raw: "partially_copy" },
    { category: "retention", label: "reference", detail: "只参考音色、节奏、内容或声音质感", kind: "marker", raw: "reference" },

    { category: "task", label: "reference generation", detail: "参考生成", kind: "task", raw: "[reference generation]" },
    { category: "task", label: "keyframe completion", detail: "关键帧补全", kind: "task", raw: "[keyframe completion]" },
    { category: "task", label: "video editing", detail: "直接编辑已有视频", kind: "task", raw: "[video editing]" },
    { category: "task", label: "video continuation", detail: "从已有视频继续生成", kind: "task", raw: "[video continuation]" },
    { category: "task", label: "audio reuse", detail: "直接复用同一音频信号", kind: "task", raw: "[audio reuse]" },
    { category: "task", label: "audio reference", detail: "只参考音频特征而不复制信号", kind: "task", raw: "[audio reference]" },

    { category: "camera", label: "Push In", detail: "摄影机前移", kind: "text", raw: "The camera pushes in " },
    { category: "camera", label: "Pull Out", detail: "摄影机后移", kind: "text", raw: "The camera pulls out " },
    { category: "camera", label: "Pan Left", detail: "镜头向左摇", kind: "text", raw: "The camera pans left " },
    { category: "camera", label: "Pan Right", detail: "镜头向右摇", kind: "text", raw: "The camera pans right " },
    { category: "camera", label: "Truck Left", detail: "摄影机向左平移", kind: "text", raw: "The camera trucks left " },
    { category: "camera", label: "Truck Right", detail: "摄影机向右平移", kind: "text", raw: "The camera trucks right " },
    { category: "camera", label: "Tilt Up", detail: "镜头向上仰", kind: "text", raw: "The camera tilts up " },
    { category: "camera", label: "Tilt Down", detail: "镜头向下俯", kind: "text", raw: "The camera tilts down " },
    { category: "camera", label: "Pedestal Up", detail: "摄影机整体上升", kind: "text", raw: "The camera moves upward " },
    { category: "camera", label: "Pedestal Down", detail: "摄影机整体下降", kind: "text", raw: "The camera moves downward " },
    { category: "camera", label: "Arc Shot", detail: "围绕主体作弧线移动", kind: "text", raw: "The camera moves in an arc around the subject " },
    { category: "camera", label: "Tracking Shot", detail: "跟随运动主体", kind: "text", raw: "The camera follows the moving subject in a tracking shot " },
    { category: "camera", label: "Static Shot", detail: "固定机位与镜头", kind: "text", raw: "The camera holds a static shot " },
    { category: "camera", label: "Zoom In", detail: "变焦拉近，机位不移动", kind: "text", raw: "The camera zooms in " },
    { category: "camera", label: "Zoom Out", detail: "变焦拉远，机位不移动", kind: "text", raw: "The camera zooms out " },
    { category: "camera", label: "POV", detail: "主体主观视角", kind: "text", raw: "POV, " },
    { category: "camera", label: "Roll Clockwise", detail: "镜头绕光轴顺时针滚转", kind: "text", raw: "The camera rolls clockwise " },
    { category: "camera", label: "Roll Counterclockwise", detail: "镜头绕光轴逆时针滚转", kind: "text", raw: "The camera rolls counterclockwise " },
    { category: "camera", label: "Shake Slightly", detail: "轻微机震", kind: "text", raw: "The camera shakes slightly " },
    { category: "camera", label: "Shake Strongly", detail: "强烈机震", kind: "text", raw: "The camera shakes strongly " },
  ];
}

function categoryMeta(id) {
  return CATEGORY_META.find((item) => item.id === id) || { id, label: id, icon: "›", detail: "" };
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

function parseDialogueRaw(raw) {
  const match = String(raw || "").match(/^<d>\[([^\]]+)\]\s*([\s\S]*?)<\/d>$/i);
  return match ? { language: match[1] || "English", text: match[2] || "" } : { language: "English", text: "" };
}

function dialogueRaw(language, text) {
  return `<d>[${language || "English"}] ${String(text || "")}</d>`;
}

function notifyDialogueChanged(block) {
  const editor = block.closest?.(".terry-h3-editor");
  if (!editor) return;
  editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: null }));
}

function enhanceDialogueBlock(block, focusText = false) {
  if (!block?.classList?.contains("terry-h3-dialogue") || block.__terryDialogueEnhanced) return block;
  block.__terryDialogueEnhanced = true;
  const parsed = parseDialogueRaw(block.dataset.raw);
  block.replaceChildren();
  block.classList.add("terry-h3-dialogue-editor");
  block.contentEditable = "false";

  const select = document.createElement("select");
  select.className = "terry-h3-dialogue-language";
  select.setAttribute("aria-label", "对白语言");
  const languageNames = [...LANGUAGES];
  if (parsed.language && !languageNames.includes(parsed.language)) languageNames.unshift(parsed.language);
  for (const language of languageNames) {
    const option = document.createElement("option");
    option.value = option.textContent = language;
    if (language === parsed.language) option.selected = true;
    select.append(option);
  }

  const text = document.createElement("span");
  text.className = "terry-h3-dialogue-text";
  text.contentEditable = "true";
  text.spellcheck = false;
  text.dataset.placeholder = "输入对白…";
  text.textContent = parsed.text;

  const updateRaw = () => {
    block.dataset.raw = dialogueRaw(select.value, text.innerText.replaceAll("\n", " "));
    notifyDialogueChanged(block);
  };
  select.addEventListener("change", updateRaw);
  select.addEventListener("pointerdown", (event) => event.stopPropagation());
  select.addEventListener("keydown", (event) => event.stopPropagation());
  text.addEventListener("input", updateRaw);
  text.addEventListener("pointerdown", (event) => event.stopPropagation());
  text.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter") event.preventDefault();
  });
  block.addEventListener("pointerdown", (event) => event.stopPropagation());
  block.append(select, text);
  if (focusText) {
    queueMicrotask(() => {
      text.focus({ preventScroll: true });
      const selection = window.getSelection?.();
      if (!selection) return;
      const range = document.createRange();
      range.selectNodeContents(text);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    });
  }
  return block;
}

function enhanceDialogues(editor) {
  for (const block of editor?.querySelectorAll?.(".terry-h3-dialogue") || []) enhanceDialogueBlock(block);
}

function createDialogueBlock(language = "English", value = "") {
  const block = chip(dialogueRaw(language, value), "", "terry-h3-dialogue");
  return enhanceDialogueBlock(block, true);
}

function visualNodesForCommand(command) {
  const fragment = document.createDocumentFragment();
  if (command.kind === "section") fragment.append(chip(command.raw, command.label.replaceAll("_", " "), "terry-h3-strong"));
  else if (command.kind === "marker") fragment.append(chip(command.raw, command.raw.replaceAll("_", " ")));
  else if (command.kind === "speaker") fragment.append(chip(command.raw, `🎙 ${command.raw.slice(1, -1)}`));
  else if (command.kind === "time") fragment.append(chip(command.raw, `⏱ ${command.raw}`));
  else if (command.kind === "transition") fragment.append(chip(command.raw, "↪ scene transition"));
  else if (command.kind === "cutoff") fragment.append(chip(command.raw, "✂ cutoff"));
  else if (command.kind === "task") fragment.append(chip(command.raw, command.raw.slice(1, -1), "terry-h3-strong"));
  else if (command.kind === "dialogue") fragment.append(createDialogueBlock(command.language || "English", ""));
  else if (command.kind === "shot") {
    const shotRaw = `[Shot ${command.shot}]`;
    fragment.append(chip(shotRaw, `🎬 Shot ${command.shot}`, "terry-h3-strong"));
    if (command.shot > 1) {
      fragment.append(document.createTextNode(" At "));
      fragment.append(chip("00:00.000", "⏱ 00:00.000"));
      fragment.append(document.createTextNode(", "));
    } else fragment.append(document.createTextNode(" "));
  } else fragment.append(document.createTextNode(command.raw || ""));
  fragment.append(document.createTextNode(CARET));
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
  const dialogue = command.kind === "dialogue" ? editor.querySelector(".terry-h3-dialogue-editor:last-of-type") : null;
  const selection = window.getSelection?.();
  if (selection && !dialogue) {
    const caret = document.createRange();
    caret.setStart(marker, marker.textContent.length);
    caret.collapse(true);
    selection.removeAllRanges();
    selection.addRange(caret);
  }
  closeMenu(node);
  editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: null }));
  enhanceDialogues(editor);
  if (dialogue) dialogue.querySelector(".terry-h3-dialogue-text")?.focus?.({ preventScroll: true });
  else editor.focus({ preventScroll: true });
}

function enterCategory(node, categoryId) {
  const state = node.__terryH3CommandState;
  if (!state) return;
  state.category = categoryId;
  state.active = 0;
  renderMenu(node);
  positionMenu(state.menu, node.__terryH3Editor);
}

function returnToCategories(node) {
  const state = node.__terryH3CommandState;
  if (!state) return;
  state.category = null;
  state.active = 0;
  renderMenu(node);
  positionMenu(state.menu, node.__terryH3Editor);
}

function filteredCommands(node, query) {
  const all = commands(node);
  if (!query) return all;
  return all.filter((command) => {
    const meta = categoryMeta(command.category);
    return `${command.label} ${meta.label} ${command.detail || ""} ${command.raw || ""}`.toLowerCase().includes(query);
  });
}

function renderMenu(node) {
  const state = node.__terryH3CommandState;
  if (!state) return;
  const { menu } = state;
  const searchMode = Boolean(state.query);
  const all = filteredCommands(node, state.query);
  menu.replaceChildren();

  const head = document.createElement("div");
  head.className = "terry-h3-command-head";
  const titleWrap = document.createElement("div");
  titleWrap.className = "terry-h3-command-head-title";
  if (state.category && !searchMode) {
    const back = document.createElement("button");
    back.type = "button";
    back.className = "terry-h3-command-back";
    back.textContent = "‹";
    back.title = "返回分类";
    back.addEventListener("pointerdown", (event) => {
      event.preventDefault(); event.stopPropagation(); returnToCategories(node);
    });
    titleWrap.append(back);
  }
  const heading = document.createElement("b");
  heading.textContent = searchMode ? "搜索 H3 语法" : state.category ? categoryMeta(state.category).label : "H3 语法";
  titleWrap.append(heading);
  const hint = document.createElement("span");
  hint.textContent = searchMode ? `“${state.query}”` : state.category ? "← 返回 · ↑↓ 选择" : "选择分类 · 也可继续输入关键词";
  head.append(titleWrap, hint);
  menu.append(head);

  if (!state.category && !searchMode) {
    state.options = CATEGORY_META.map((meta) => ({ type: "category", meta, count: all.filter((command) => command.category === meta.id).length }));
  } else {
    const list = state.category && !searchMode ? all.filter((command) => command.category === state.category) : all;
    state.options = list.map((command) => ({ type: "command", command }));
  }
  state.active = Math.min(state.active, Math.max(0, state.options.length - 1));

  if (!state.options.length) {
    const empty = document.createElement("div");
    empty.className = "terry-h3-command-empty";
    empty.textContent = "没有匹配的 H3 语法";
    menu.append(empty);
    return;
  }

  state.options.forEach((option, index) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `terry-h3-command-item${index === state.active ? " is-active" : ""}${option.type === "category" ? " is-category" : ""}`;
    if (option.type === "category") {
      const icon = document.createElement("span");
      icon.className = "terry-h3-command-category-icon";
      icon.textContent = option.meta.icon;
      const text = document.createElement("span");
      text.className = "terry-h3-command-text";
      const title = document.createElement("b"); title.textContent = option.meta.label;
      const detail = document.createElement("small"); detail.textContent = option.meta.detail;
      text.append(title, detail);
      const count = document.createElement("span");
      count.className = "terry-h3-command-count";
      count.textContent = `${option.count} ›`;
      item.append(icon, text, count);
      item.addEventListener("pointerdown", (event) => {
        event.preventDefault(); event.stopPropagation(); enterCategory(node, option.meta.id);
      });
    } else {
      const meta = categoryMeta(option.command.category);
      const category = document.createElement("span");
      category.className = "terry-h3-command-category";
      category.textContent = meta.label;
      const text = document.createElement("span");
      text.className = "terry-h3-command-text";
      const title = document.createElement("b"); title.textContent = option.command.label;
      const detail = document.createElement("small"); detail.textContent = option.command.detail || option.command.raw || "";
      text.append(title, detail);
      item.append(category, text);
      item.addEventListener("pointerdown", (event) => {
        event.preventDefault(); event.stopPropagation(); choose(node, option.command);
      });
    }
    item.addEventListener("pointermove", () => {
      if (!node.__terryH3CommandState || state.active === index) return;
      state.active = index;
      renderMenu(node);
    });
    menu.append(item);
  });
}

function positionMenu(menu, editor) {
  const selection = window.getSelection?.();
  const caret = selection?.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : null;
  const rect = caret && (caret.width || caret.height) ? caret : editor.getBoundingClientRect();
  const width = 320;
  const height = Math.min(340, menu.offsetHeight || 260);
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
  const hit = commandRange(editor);
  if (!hit) { closeMenu(node); return false; }
  let state = node.__terryH3CommandState;
  if (!state) {
    const menu = document.createElement("div");
    menu.className = "terry-h3-command-menu";
    document.body.append(menu);
    state = node.__terryH3CommandState = { menu, range: hit.range, options: [], active: 0, category: null, query: hit.query };
    node.__terryH3CommandMenu = menu;
  } else {
    const queryChanged = state.query !== hit.query;
    state.range = hit.range;
    state.query = hit.query;
    if (queryChanged && hit.query) state.category = null;
    if (queryChanged) state.active = 0;
  }
  renderMenu(node);
  positionMenu(state.menu, editor);
  return true;
}

function handleCommandKeys(node, event) {
  const state = node.__terryH3CommandState;
  if (!state) return false;
  if (event.key === "Escape") { closeMenu(node); return true; }
  if (event.key === "ArrowLeft" && state.category && !state.query) { returnToCategories(node); return true; }
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    if (state.options.length) {
      const delta = event.key === "ArrowDown" ? 1 : -1;
      state.active = (state.active + delta + state.options.length) % state.options.length;
      renderMenu(node);
      state.menu.querySelector(".is-active")?.scrollIntoView?.({ block: "nearest" });
    }
    return true;
  }
  if (event.key === "ArrowRight" || event.key === "Enter" || event.key === "Tab") {
    const option = state.options[state.active];
    if (!option) return false;
    if (option.type === "category") enterCategory(node, option.meta.id);
    else choose(node, option.command);
    return true;
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
    enhanceDialogues(editor);
    if (node?.properties?.[VIEW_PROP] !== "raw") queueMicrotask(() => openMenu(node));
    else closeMenu(node);
  });
  editor.addEventListener("keyup", (event) => {
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", "Tab", "Escape"].includes(event.key)) openMenu(node);
  });
  editor.addEventListener("keydown", (event) => {
    if (event.target?.closest?.(".terry-h3-dialogue-editor")) return;
    if (!handleCommandKeys(node, event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  }, true);
  editor.addEventListener("blur", () => setTimeout(() => {
    if (!node.__terryH3CommandMenu?.matches?.(":hover")) closeMenu(node);
  }, 150));

  const observer = new MutationObserver(() => enhanceDialogues(editor));
  observer.observe(editor, { childList: true, subtree: true });
  editor.__terryH3DialogueObserver = observer;
  enhanceDialogues(editor);
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
.terry-h3-command-menu{position:fixed;z-index:10090;width:320px;max-height:340px;overflow:auto;padding:5px;border:1px solid rgba(255,255,255,.15);border-radius:9px;background:var(--comfy-menu-bg,#202225);box-shadow:0 16px 38px rgba(0,0,0,.46);color:var(--input-text,#ddd)}
.terry-h3-command-head{position:sticky;top:-5px;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 8px;border-bottom:1px solid rgba(255,255,255,.09);background:var(--comfy-menu-bg,#202225);font:12px/1.3 system-ui,sans-serif}
.terry-h3-command-head-title{display:flex;align-items:center;gap:5px;min-width:0}.terry-h3-command-head span{max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;opacity:.48}
.terry-h3-command-back{display:grid;place-items:center;width:23px;height:23px;padding:0;border:0;border-radius:5px;background:rgba(255,255,255,.06);color:inherit;cursor:pointer;font:18px/1 system-ui,sans-serif}
.terry-h3-command-item{display:grid;grid-template-columns:68px minmax(0,1fr);gap:8px;align-items:center;width:100%;min-height:42px;padding:5px 7px;border:0;border-radius:6px;background:transparent;color:inherit;text-align:left;cursor:pointer}
.terry-h3-command-item:hover,.terry-h3-command-item.is-active{background:rgba(255,255,255,.09)}
.terry-h3-command-item.is-category{grid-template-columns:30px minmax(0,1fr) auto;min-height:48px}
.terry-h3-command-category-icon{display:grid;place-items:center;width:28px;height:28px;border-radius:6px;background:rgba(255,255,255,.07);font:13px/1 system-ui,sans-serif;opacity:.82}
.terry-h3-command-count{font:10px/1 system-ui,sans-serif;opacity:.42}
.terry-h3-command-category{display:inline-flex;align-items:center;justify-content:center;min-height:22px;padding:2px 5px;border-radius:4px;background:rgba(255,255,255,.07);font:10px/1.2 system-ui,sans-serif;opacity:.72}
.terry-h3-command-text{min-width:0}.terry-h3-command-text b,.terry-h3-command-text small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.terry-h3-command-text b{font:600 12px/1.3 Consolas,monospace}.terry-h3-command-text small{margin-top:3px;font:10px/1.25 system-ui,sans-serif;opacity:.52}
.terry-h3-command-empty{padding:12px;font:11px/1.4 system-ui,sans-serif;opacity:.62}
.terry-h3-dialogue-editor{display:inline-flex!important;align-items:center!important;gap:5px!important;max-width:min(520px,90%)!important;padding:2px 4px!important;background:rgba(0,226,187,.12)!important;color:rgba(190,255,244,.98)!important;white-space:normal!important;vertical-align:middle!important}
.terry-h3-dialogue-language{height:22px;max-width:108px;padding:0 4px;border:0;border-radius:4px;outline:none;background:rgba(0,0,0,.24);color:inherit;font:10px/1 system-ui,sans-serif;cursor:pointer}
.terry-h3-dialogue-text{display:inline-block;min-width:72px;max-width:360px;overflow:hidden;white-space:nowrap;text-overflow:clip;outline:none;border:0;color:inherit;caret-color:currentColor;font:11px/1.5 Consolas,monospace;cursor:text}
.terry-h3-dialogue-text:empty:before{content:attr(data-placeholder);opacity:.42;pointer-events:none}
.terry-h3-dialogue-text:focus{background:rgba(255,255,255,.035);border-radius:3px}
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
    nodeType.prototype.onNodeCreated = function() { const result = created?.apply(this, arguments); installSoon(this); return result; };
    const added = nodeType.prototype.onAdded;
    nodeType.prototype.onAdded = function() { const result = added?.apply(this, arguments); installSoon(this); return result; };
    const configured = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function() { const result = configured?.apply(this, arguments); installSoon(this); return result; };
    const draw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function() {
      const result = draw?.apply(this, arguments);
      if (this.__terryH3Editor) { bindToggle(this); bindEditor(this); syncBooleanView(this); enhanceDialogues(this.__terryH3Editor); }
      return result;
    };
  },
  loadedGraphNode(node) { installSoon(node); },
});
