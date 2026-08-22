import { app } from "../../scripts/app.js";

function cleanup(root = document) {
  for (const menu of root.querySelectorAll?.(".terry-h3-mention") || []) {
    menu.remove();
  }
}

let observer = null;
function install() {
  if (globalThis.__terryH3LegacyMentionCleanupInstalled) return;
  globalThis.__terryH3LegacyMentionCleanupInstalled = true;

  cleanup();
  observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const added of record.addedNodes || []) {
        if (!(added instanceof HTMLElement)) continue;
        if (added.matches?.(".terry-h3-mention")) {
          added.remove();
          continue;
        }
        cleanup(added);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

app.registerExtension({
  name: "TerryToolbox.H3LegacyMentionCleanup",
  setup() { install(); },
  afterConfigureGraph() { install(); },
});