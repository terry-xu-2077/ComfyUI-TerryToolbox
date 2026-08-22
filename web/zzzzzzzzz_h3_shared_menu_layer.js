import { app } from "../../scripts/app.js";

function installStyle() {
  if (document.getElementById("terry-h3-shared-menu-layer-style")) return;
  const style = document.createElement("style");
  style.id = "terry-h3-shared-menu-layer-style";
  style.textContent = `
/* Shared H3 @ and / menus must live above ComfyUI node DOM / Nodes 2.0 layers. */
body > .terry-h3-shared-menu,
body > .terry-h3-role-menu.terry-h3-shared-menu,
body > .terry-h3-command-menu.terry-h3-shared-menu {
  position: fixed !important;
  z-index: 2147483000 !important;
  isolation: isolate !important;
  pointer-events: auto !important;
  opacity: 1 !important;
  visibility: visible !important;
  transform: none !important;
}

body > .terry-h3-shared-menu * {
  pointer-events: auto;
}
`;
  document.head.append(style);
}

function promoteMenus(root = document) {
  for (const menu of root.querySelectorAll?.(".terry-h3-shared-menu") || []) {
    // Shared menus are already created under document.body, but re-parent if a
    // future code path or Nodes 2.0 host places them inside a transformed node DOM.
    if (menu.parentElement !== document.body) document.body.append(menu);
    menu.style.setProperty("position", "fixed", "important");
    menu.style.setProperty("z-index", "2147483000", "important");
    menu.style.setProperty("isolation", "isolate", "important");
    menu.style.setProperty("pointer-events", "auto", "important");
  }
}

let observer = null;
function install() {
  installStyle();
  promoteMenus();
  if (observer) return;
  observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const added of record.addedNodes || []) {
        if (!(added instanceof HTMLElement)) continue;
        if (added.matches?.(".terry-h3-shared-menu")) promoteMenus(added.parentElement || document);
        else if (added.querySelector?.(".terry-h3-shared-menu")) promoteMenus(added);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

app.registerExtension({
  name: "TerryToolbox.H3SharedMenuLayer",
  setup() { install(); },
  afterConfigureGraph() { install(); },
});
