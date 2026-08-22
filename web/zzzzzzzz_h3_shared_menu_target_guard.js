import { app } from "../../scripts/app.js";

const EDITOR_SELECTOR = ".terry-h3-editor,.terry-tl-rich";

function editorOf(target) {
  return target?.closest?.(EDITOR_SELECTOR) || null;
}

function install() {
  if (globalThis.__terryH3SharedMenuTargetGuardInstalled) return;
  globalThis.__terryH3SharedMenuTargetGuardInstalled = true;

  // Keep document-level shared-menu listeners alive, but prevent the same
  // keyboard/input event from reaching legacy listeners attached directly to
  // the H3 editor element. Do NOT use stopImmediatePropagation here: shared
  // menus are also document capture listeners.
  document.addEventListener("beforeinput", (event) => {
    const editor = editorOf(event.target);
    if (!editor) return;
    if (event.inputType !== "insertText" || (event.data !== "@" && event.data !== "/")) return;
    event.stopPropagation();
  }, true);

  document.addEventListener("input", (event) => {
    const editor = editorOf(event.target);
    if (!editor) return;
    const state = globalThis.__terryH3SharedState;
    if (!state || state.editor !== editor) return;
    event.stopPropagation();
  }, true);

  document.addEventListener("keyup", (event) => {
    const editor = editorOf(event.target);
    if (!editor) return;
    const state = globalThis.__terryH3SharedState;
    if (!state || state.editor !== editor) return;
    event.stopPropagation();
  }, true);
}

app.registerExtension({
  name: "TerryToolbox.H3SharedMenuTargetGuard",
  setup() { install(); },
  afterConfigureGraph() { install(); },
});
