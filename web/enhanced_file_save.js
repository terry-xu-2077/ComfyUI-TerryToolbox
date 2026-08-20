import { app } from "../../scripts/app.js";

const NODE_ID = "EnhancedFileSave";

const TYPE_WIDGETS = {
  IMAGE: ["image_compress_level"],
  AUDIO: ["audio_format", "audio_quality"],
  VIDEO: ["video_format", "video_codec", "video_encoding", "video_crf"],
  STRING: ["text_extension", "text_custom_extension"],
};

const ALL_TYPE_WIDGETS = Object.values(TYPE_WIDGETS).flat();

function getWidget(node, name) {
  return node.widgets?.find((w) => w.name === name);
}

function installHideAdapter(widget) {
  if (!widget || widget.__terryHideAdapter) return;
  widget.__terryHideAdapter = true;

  widget.__terryOriginalComputeSize =
    typeof widget.computeSize === "function"
      ? widget.computeSize.bind(widget)
      : null;

  widget.computeSize = function(width) {
    if (this.hidden) return [0, -4];
    if (this.__terryOriginalComputeSize) {
      return this.__terryOriginalComputeSize(width);
    }
    return [width ?? 0, 20];
  };
}

function setWidgetHidden(node, name, hidden) {
  const w = getWidget(node, name);
  if (!w) return;

  installHideAdapter(w);

  w.hidden = hidden;

  if (w.options) {
    w.options.hidden = hidden;
  }

  if (w.element?.style) {
    w.element.style.display = hidden ? "none" : "";
  }
}

function getConnectedType(node) {
  const input = node.inputs?.find((i) => i.name === "data");
  if (!input || input.link == null) return null;

  const link = app.graph?.links?.[input.link];
  if (!link) return null;

  let type = String(link.type || "").toUpperCase();

  if (!type || type === "*") {
    const origin = app.graph?.getNodeById?.(link.origin_id);
    const output = origin?.outputs?.[link.origin_slot];
    type = String(output?.type || "").toUpperCase();
  }

  if (type === "TEXT") type = "STRING";

  return TYPE_WIDGETS[type] ? type : null;
}

function resizeToContent(node) {
  try {
    const measured = node.computeSize?.();
    if (measured) {
      const width = Math.max(node.size?.[0] ?? 0, measured[0] ?? 0);
      node.setSize?.([width, measured[1]]);
    }
  } catch (_) {}

  node.setDirtyCanvas?.(true, true);
  app.graph?.setDirtyCanvas?.(true, true);
}

function applyDynamicPanel(node) {
  // Default: no media-specific options.
  for (const name of ALL_TYPE_WIDGETS) {
    setWidgetHidden(node, name, true);
  }

  // Show only the options that belong to the connected input type.
  const type = getConnectedType(node);
  if (type) {
    for (const name of TYPE_WIDGETS[type]) {
      setWidgetHidden(node, name, false);
    }
  }

  // Timestamp dependency.
  const useTimestamp = getWidget(node, "use_timestamp")?.value === true;
  for (const name of ["ts_year", "ts_date", "ts_hour", "ts_minute_second"]) {
    setWidgetHidden(node, name, !useTimestamp);
  }

  // Sequence dependency.
  const useSequence = getWidget(node, "append_sequence")?.value === true;
  setWidgetHidden(node, "sequence_start", !useSequence);
  setWidgetHidden(node, "sequence_padding", !useSequence);

  // Audio dependency.
  if (type === "AUDIO") {
    const format = getWidget(node, "audio_format")?.value;
    setWidgetHidden(node, "audio_quality", format === "flac");
  }

  // Video dependency.
  if (type === "VIDEO") {
    const codec = getWidget(node, "video_codec")?.value;
    const encoding = getWidget(node, "video_encoding")?.value;

    setWidgetHidden(node, "video_encoding", codec !== "h264");
    setWidgetHidden(
      node,
      "video_crf",
      !(codec === "h264" && encoding === "re-encode")
    );
  }

  // Text dependency.
  if (type === "STRING") {
    const extension = getWidget(node, "text_extension")?.value;
    setWidgetHidden(node, "text_custom_extension", extension !== "custom");
  }

  resizeToContent(node);
}

function hookWidget(node, name) {
  const w = getWidget(node, name);
  if (!w || w.__terryDynamicPanelHooked) return;
  w.__terryDynamicPanelHooked = true;

  const original = w.callback;
  w.callback = function(...args) {
    const result = original?.apply(this, args);
    queueMicrotask(() => applyDynamicPanel(node));
    return result;
  };
}

function initNode(node) {
  if (!node) return;

  for (const w of node.widgets ?? []) {
    installHideAdapter(w);
  }

  for (const name of [
    "use_timestamp",
    "append_sequence",
    "audio_format",
    "video_codec",
    "video_encoding",
    "text_extension",
  ]) {
    hookWidget(node, name);
  }

  applyDynamicPanel(node);
  requestAnimationFrame(() => applyDynamicPanel(node));
}

app.registerExtension({
  name: "TerryToolbox.EnhancedFileSave.DynamicPanel",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_ID) return;

    const originalCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function() {
      const result = originalCreated?.apply(this, arguments);
      initNode(this);
      return result;
    };

    const originalConnections = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function() {
      const result = originalConnections?.apply(this, arguments);
      queueMicrotask(() => applyDynamicPanel(this));
      requestAnimationFrame(() => applyDynamicPanel(this));
      return result;
    };

    const originalConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function() {
      const result = originalConfigure?.apply(this, arguments);
      queueMicrotask(() => initNode(this));
      return result;
    };
  },

  nodeCreated(node) {
    if (node?.comfyClass === NODE_ID || node?.constructor?.type === NODE_ID) {
      queueMicrotask(() => initNode(node));
    }
  },

  loadedGraphNode(node) {
    if (node?.comfyClass === NODE_ID || node?.constructor?.type === NODE_ID) {
      queueMicrotask(() => initNode(node));
    }
  },
});
