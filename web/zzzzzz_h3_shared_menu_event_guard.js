import { app } from "../../scripts/app.js";

const EDITOR_SELECTOR = ".terry-h3-editor,.terry-tl-rich";
const armedEditors = new WeakSet();

function editorOf(target) {
  return target?.closest?.(EDITOR_SELECTOR) || null;
}

function isSharedTrigger(event) {
  return event?.inputType === "insertText" && (event?.data === "@" || event?.data === "/");
}

function install() {
  if (globalThis.__terryH3SharedMenuEventGuardInstalled) return;
  globalThis.__terryH3SharedMenuEventGuardInstalled = true;

  // zzzz_h3_shared_menus.js is loaded before this file, so its document-level
  // capture listener gets the trigger first. We then stop the same event from
  // reaching the legacy target listeners still embedded in h3_prompt_editor.js.
  document.addEventListener("beforeinput", (event) => {
    const editor = editorOf(event.target);
    if (!editor || !isSharedTrigger(event)) return;
    armedEditors.add(editor);
    event.stopImmediatePropagation?.();
    event.stopPropagation?.();
  }, true);

  // The browser still performs the text insertion after beforeinput. Block only
  // that resulting input event from reaching the legacy editor listener; the
  // shared menu already scheduled itself from beforeinput.
  document.addEventListener("input", (event) => {
    const editor = editorOf(event.target);
    if (!editor || !armedEditors.has(editor)) return;
    armedEditors.delete(editor);
    event.stopImmediatePropagation?.();
    event.stopPropagation?.();
  }, true);

  // The legacy prompt editor also refreshes its fallback menu on keyup.
  document.addEventListener("keyup", (event) => {
    const editor = editorOf(event.target);
    if (!editor) return;
    const state = globalThis.__terryH3SharedState;
    if (!state || state.editor !== editor) return;
    event.stopImmediatePropagation?.();
    event.stopPropagation?.();
  }, true);
}

app.registerExtension({
  name: "TerryToolbox.H3SharedMenuEventGuard",
  setup() { install(); },
  afterConfigureGraph() { install(); },
});
