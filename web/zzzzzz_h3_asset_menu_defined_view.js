import { app } from "../../scripts/app.js";

const ROLE_PROP = "terry_h3_default_image_role";
const BINDINGS_PROP = "terry_h3_subject_bindings";
const FILTER_PROP = "terry_h3_asset_menu_filter";

function nodeType(node) {
  return String(node?.comfyClass || node?.type || node?.constructor?.comfyClass || node?.constructor?.type || "");
}
function isTimeline(node) { return nodeType(node) === "TerryH3ShotTimeline"; }
function promptText(node) {
  const names = isTimeline(node) ? ["compiled_prompt", "timeline_state"] : ["prompt"];
  return names.map((name) => String(node?.widgets?.find?.((w) => w?.name === name)?.value || "")).join("\n");
}
function bindings(node) {
  const value = node?.properties?.[BINDINGS_PROP];
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function assetRows(menu) { return [...menu.querySelectorAll(":scope > .terry-h3-role-row")]; }
function labelsForRow(row) {
  const actionButtons = [...row.querySelectorAll(".terry-h3-role-actions .terry-h3-role-action")];
  const subjectLabels = actionButtons.map((b) => b.textContent.trim()).filter((x) => /^Subject\s+\d+$/i.test(x));
  const direct = actionButtons.map((b) => b.textContent.trim()).find((x) => /^(Picture|Video|Audio)\s+\d+$/i.test(x)) || "";
  return { actionButtons, subjectLabels, direct };
}
function assetKeyFromRow(row, node) {
  const direct = labelsForRow(row).direct;
  if (!direct) return null;
  const match = direct.match(/^(Picture|Video|Audio)\s+(\d+)$/i);
  if (!match) return null;
  const kind = match[1].toLowerCase();
  const index = Number(match[2]);
  const prop = isTimeline(node) ? "terry_h3_timeline_virtual_media_links" : "terry_h3_virtual_media_links";
  const links = Array.isArray(node?.properties?.[prop]) ? node.properties[prop] : [];
  let seen = 0;
  for (const link of links) {
    const raw = String(link?.kind || link?.source_type || "").toLowerCase();
    const linkKind = raw.includes("audio") ? "audio" : raw.includes("video") ? "video" : "picture";
    if (linkKind !== kind) continue;
    seen += 1;
    if (seen === index) return `${Number(link.source_id)}:${Number(link.source_slot) || 0}`;
  }
  return null;
}
function definitionInfo(row, node) {
  const { direct } = labelsForRow(row);
  const key = assetKeyFromRow(row, node);
  const subjects = key ? (Array.isArray(bindings(node)[key]) ? bindings(node)[key].map(Number).filter(Number.isFinite) : []) : [];
  const text = promptText(node);
  const directUsed = direct ? new RegExp(`<${direct.replace(/\s+/g, "\\s+")}>`, "i").test(text) : false;
  const parts = subjects.map((n) => `主体 ${n}`);
  if (directUsed && direct) parts.push(direct.replace(/^Picture/i, "图片").replace(/^Video/i, "视频").replace(/^Audio/i, "音频"));
  return { defined: parts.length > 0, parts, direct, subjects };
}
function filterName(node) {
  return String(node?.properties?.[FILTER_PROP] || node?.properties?.[ROLE_PROP] || "subject");
}
function setFilter(node, value) {
  node.properties ||= {};
  node.properties[FILTER_PROP] = value;
  if (value === "subject" || value === "picture") node.properties[ROLE_PROP] = value;
  app.graph?.change?.();
}
function makeTab(label, active, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `terry-h3-role-action${active ? " is-active" : ""}`;
  button.textContent = label;
  button.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); onClick(); });
  return button;
}
function reopenAssetMenu(state) {
  const editor = state?.editor;
  if (!editor) return;
  editor.focus({ preventScroll: true });
  editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: null }));
}
function decorate(menu) {
  if (!menu?.classList?.contains("terry-h3-role-menu") || menu.dataset.terryDefinedView === "1") return;
  const state = globalThis.__terryH3SharedState;
  const node = state?.type === "asset" ? state.node : null;
  if (!node) return;
  menu.dataset.terryDefinedView = "1";

  const rows = assetRows(menu);
  const infos = new Map(rows.map((row) => [row, definitionInfo(row, node)]));
  const hasDefined = [...infos.values()].some((info) => info.defined);
  let filter = filterName(node);
  if (filter === "defined" && !hasDefined) filter = "subject";

  const legend = menu.querySelector(".terry-h3-role-legend");
  const tabs = legend?.querySelector(".terry-h3-role-tabs");
  if (tabs) {
    tabs.replaceChildren();
    tabs.append(
      makeTab("主体参考", filter === "subject", () => { setFilter(node, "subject"); reopenAssetMenu(state); }),
      makeTab("画面参考", filter === "picture", () => { setFilter(node, "picture"); reopenAssetMenu(state); }),
    );
    if (hasDefined) tabs.append(makeTab("已引用参考", filter === "defined", () => { setFilter(node, "defined"); reopenAssetMenu(state); }));
  }

  const help = legend?.querySelector(".terry-h3-role-help");
  if (help && filter === "defined") help.textContent = "仅显示已经建立 Subject 或已经在提示词中引用过的资产。";

  for (const row of rows) {
    const info = infos.get(row);
    const actions = row.querySelector(".terry-h3-role-actions");
    const meta = row.querySelector(".terry-h3-role-info small");
    const buttons = info.actionButtons;
    const subjectButton = buttons.find((b) => /^Subject\s+\d+$/i.test(b.textContent.trim()) || /^\+\s*Subject$/i.test(b.textContent.trim()));
    const directButton = buttons.find((b) => /^(Picture|Video|Audio)\s+\d+$/i.test(b.textContent.trim()));

    row.querySelectorAll(".terry-h3-defined-info").forEach((el) => el.remove());
    if (filter === "defined") {
      if (!info.defined) { row.style.display = "none"; continue; }
      row.style.display = "grid";
      if (actions) actions.style.display = "none";
      const defined = document.createElement("div");
      defined.className = "terry-h3-defined-info";
      defined.textContent = info.parts.join(" · ");
      row.querySelector(".terry-h3-role-info")?.append(defined);
      if (meta) meta.style.display = "none";
      continue;
    }

    row.style.display = "grid";
    if (meta) meta.style.display = "block";
    if (actions) {
      actions.style.display = "flex";
      for (const b of buttons) b.style.display = "none";
      if (filter === "subject") {
        if (subjectButton) {
          subjectButton.style.display = "inline-flex";
          subjectButton.textContent = /^Subject\s+(\d+)$/i.test(subjectButton.textContent.trim())
            ? subjectButton.textContent.trim().replace(/^Subject/i, "主体")
            : "+ 主体";
        }
      } else if (filter === "picture" && directButton) {
        directButton.style.display = "inline-flex";
        directButton.textContent = directButton.textContent.trim().replace(/^Picture/i, "图片").replace(/^Video/i, "视频").replace(/^Audio/i, "音频");
      }
    }
  }
}

function installStyle() {
  if (document.getElementById("terry-h3-defined-menu-style")) return;
  const style = document.createElement("style");
  style.id = "terry-h3-defined-menu-style";
  style.textContent = `
.terry-h3-defined-info{margin-top:5px;font:600 10px/1.35 system-ui,sans-serif;color:rgba(190,255,244,.9);white-space:normal}
.terry-h3-role-menu .terry-h3-role-tabs{flex-wrap:wrap}
.terry-h3-role-menu .terry-h3-role-actions{min-width:64px}
`;
  document.head.append(style);
}

let observer;
function install() {
  installStyle();
  if (observer) return;
  observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes || []) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.matches?.(".terry-h3-role-menu.terry-h3-shared-menu")) queueMicrotask(() => decorate(node));
        node.querySelectorAll?.(".terry-h3-role-menu.terry-h3-shared-menu").forEach((menu) => queueMicrotask(() => decorate(menu)));
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  document.querySelectorAll(".terry-h3-role-menu.terry-h3-shared-menu").forEach(decorate);
}

app.registerExtension({
  name: "TerryToolbox.H3AssetMenuDefinedView",
  setup() { install(); },
  afterConfigureGraph() { install(); },
});
