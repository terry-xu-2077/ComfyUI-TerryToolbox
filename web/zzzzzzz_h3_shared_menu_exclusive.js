import { app } from "../../scripts/app.js";

const TARGETS = new Set(["TerryH3PromptEditor", "TerryH3ShotTimeline"]);

function nodeType(node) {
  return String(
    node?.comfyClass || node?.type || node?.constructor?.comfyClass ||
    node?.constructor?.type || node?.constructor?.nodeData?.name || ""
  );
}

function isTarget(node) {
  return TARGETS.has(nodeType(node));
}

function isSharedMenu(el) {
  return el?.classList?.contains("terry-h3-shared-menu");
}

function removeLegacyMenus() {
  for (const el of document.querySelectorAll(
    ".terry-h3-role-menu, .terry-h3-command-menu, .terry-tl-mention"
  )) {
    if (!isSharedMenu(el)) el.remove();
  }

  for (const node of app.graph?._nodes || []) {
    if (!isTarget(node)) continue;
    if (node.__terryH3RoleMenu && !isSharedMenu(node.__terryH3RoleMenu)) {
      node.__terryH3RoleMenu.remove?.();
      node.__terryH3RoleMenu = null;
      node.__terryH3RoleState = null;
    }
    if (node.__terryH3CommandMenu && !isSharedMenu(node.__terryH3CommandMenu)) {
      node.__terryH3CommandMenu.remove?.();
      node.__terryH3CommandMenu = null;
      node.__terryH3CommandState = null;
    }
  }
}

let observer = null;
function install() {
  globalThis.__terryH3SharedMenusExclusive = true;
  removeLegacyMenus();
  if (observer) return;
  observer = new MutationObserver((records) => {
    let needsCleanup = false;
    for (const record of records) {
      for (const added of record.addedNodes || []) {
        if (!(added instanceof HTMLElement)) continue;
        if (
          (added.matches?.(".terry-h3-role-menu,.terry-h3-command-menu,.terry-tl-mention") && !isSharedMenu(added)) ||
          added.querySelector?.(".terry-h3-role-menu:not(.terry-h3-shared-menu),.terry-h3-command-menu:not(.terry-h3-shared-menu),.terry-tl-mention")
        ) {
          needsCleanup = true;
          break;
        }
      }
      if (needsCleanup) break;
    }
    if (needsCleanup) queueMicrotask(removeLegacyMenus);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

app.registerExtension({
  name: "TerryToolbox.H3SharedMenuExclusive",
  setup() { install(); },
  afterConfigureGraph() { install(); },
});
