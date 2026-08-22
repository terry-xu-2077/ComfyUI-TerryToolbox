import { app } from "../../scripts/app.js";

const NODE_ID = "TerryH3PromptEditor";
const CARET = "\u200B";

function nodeType(node) {
  return String(node?.comfyClass || node?.type || node?.constructor?.comfyClass || node?.constructor?.type || "");
}

function nextShot(node) {
  const text = String(node?.widgets?.find?.((w) => w?.name === "prompt")?.value || "");
  let max = 0;
  for (const m of text.matchAll(/\[Shot\s+(\d+)\]/gi)) max = Math.max(max, Number(m[1]) || 0);
  return max + 1;
}

function chip(raw, label, strong = false) {
  const el = document.createElement("span");
  el.className = `terry-h3-chip${strong ? " terry-h3-strong" : ""}`;
  el.contentEditable = "false";
  el.dataset.raw = raw;
  el.textContent = label;
  return el;
}

function insert(state, nodes) {
  if (!state?.range || !state?.editor) return;
  state.range.deleteContents();
  const marker = document.createTextNode(CARET);
  const frag = document.createDocumentFragment();
  for (const node of nodes) frag.append(node);
  frag.append(marker);
  state.range.insertNode(frag);
  const selection = window.getSelection?.();
  if (selection) {
    const range = document.createRange();
    range.setStart(marker, marker.textContent.length);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }
  state.menu?.remove?.();
  globalThis.__terryH3SharedState = null;
  state.editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: null }));
  state.editor.focus({ preventScroll: true });
}

function commandButton(label, detail, callback) {
  const item = document.createElement("button");
  item.type = "button";
  item.className = "terry-h3-command-item terry-h3-shared-shot-extra";
  const category = document.createElement("span");
  category.className = "terry-h3-command-category";
  category.textContent = "镜头";
  const text = document.createElement("span");
  text.className = "terry-h3-command-text";
  const title = document.createElement("b"); title.textContent = label;
  const small = document.createElement("small"); small.textContent = detail;
  text.append(title, small);
  item.append(category, text);
  item.addEventListener("pointerdown", (event) => {
    event.preventDefault(); event.stopPropagation(); callback();
  });
  return item;
}

function patch() {
  const state = globalThis.__terryH3SharedState;
  if (!state || state.type !== "command" || nodeType(state.node) !== NODE_ID || !state.menu?.isConnected) return;
  if (state.menu.querySelector(".terry-h3-shared-shot-extra")) return;

  const heading = state.menu.querySelector(".terry-h3-command-head-title b")?.textContent || "";
  const shotView = state.category === "shot" || /shot|镜头/i.test(String(state.query || ""));
  if (!shotView) return;

  const n = nextShot(state.node);
  state.menu.append(
    commandButton(`Shot ${n}`, n === 1 ? "首镜头，无时间戳" : "自动使用下一个 Shot 编号", () => {
      const nodes = [chip(`[Shot ${n}]`, `🎬 Shot ${n}`, true)];
      if (n > 1) {
        nodes.push(document.createTextNode(" At "), chip("00:00.000", "⏱ 00:00.000"), document.createTextNode(", "));
      } else nodes.push(document.createTextNode(" "));
      insert(state, nodes);
    }),
    commandButton("时间戳", "插入 MM:SS.mmm 占位", () => insert(state, [chip("00:00.000", "⏱ 00:00.000")]))
  );
}

app.registerExtension({
  name: "TerryToolbox.H3SharedPromptShotCommands",
  setup() { setInterval(patch, 80); },
});
