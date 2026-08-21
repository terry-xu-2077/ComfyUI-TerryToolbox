from __future__ import annotations

import re

from comfy_api.latest import io


_SECTION_RE = re.compile(
    r"(?im)^\s*(subject_definitions|summary|retention_analysis)\s*:\s*"
)
_STORYBOARD_HEADER_RE = re.compile(
    r"(?im)^\s*\[(?:分镜脚本|分镜|镜头脚本|shot\s*list|storyboard)\]\s*$"
)
_SUBJECT_HEADER_RE = re.compile(
    r"(?im)^\s*\[(?:全局参考|主体定义|主体设定|subject[_\s-]*definitions?|global\s*reference)\]\s*$"
)
_DEFINITION_LINE_RE = re.compile(
    r"(?im)^\s*<(?:Subject|Picture|Video|Audio)\s+\d+>\s*(?:is\b|[:：-])?.*$"
)
_SHOT_RE = re.compile(r"(?im)^\s*\[Shot\s+\d+\]")


def _split_official_sections(text: str) -> tuple[dict[str, str], str]:
    """Pull official pre-detailed H3 sections out of a loose/global block."""
    matches = list(_SECTION_RE.finditer(text))
    if not matches:
        return {}, text.strip()

    sections: dict[str, str] = {}
    leftovers: list[str] = []
    cursor = 0
    for index, match in enumerate(matches):
        if match.start() > cursor:
            chunk = text[cursor:match.start()].strip()
            if chunk:
                leftovers.append(chunk)
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        sections[match.group(1).lower()] = text[match.end():end].strip()
        cursor = end
    if cursor < len(text):
        tail = text[cursor:].strip()
        if tail:
            leftovers.append(tail)
    return sections, "\n\n".join(leftovers).strip()


def _extract_definition_lines(text: str) -> tuple[str, str]:
    """Use obvious <Subject/Picture/Video/Audio N> definitions as subject_definitions."""
    definitions: list[str] = []
    remaining: list[str] = []
    for line in text.splitlines():
        if _DEFINITION_LINE_RE.match(line):
            definitions.append(line.strip())
        else:
            remaining.append(line)
    return "\n".join(definitions).strip(), "\n".join(remaining).strip()


def _restore_official_h3(compiled_prompt: str) -> str:
    """Normalize the timeline editor's loose state back to an official-like H3 layout.

    The visual editor intentionally stores all non-shot material in one Global box.
    On execution we recover the canonical H3 boundaries:
      subject_definitions -> optional summary/retention_analysis -> detailed_description.
    Common AI headings such as [分镜脚本] are treated as aliases for
    detailed_description rather than emitted literally.
    """
    text = str(compiled_prompt or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if text.startswith("{") and text.endswith("}"):
        text = text[1:-1].strip()

    # The frontend compiler currently places Global content after a leading
    # detailed_description:. Remove that temporary wrapper before reconstructing
    # the canonical section order.
    text = re.sub(r"(?is)^\s*detailed[_\s-]*description\s*:\s*", "", text, count=1)

    shot_match = _SHOT_RE.search(text)
    if shot_match:
        global_block = text[:shot_match.start()].strip()
        detailed_body = text[shot_match.start():].strip()
    else:
        global_block = text
        detailed_body = ""

    # AI screenplay aliases are structural hints, not literal H3 output.
    # [分镜脚本]/Storyboard becomes the detailed_description boundary below.
    # [全局参考]/主体定义 marks the definition area, but we still separate only
    # actual <Subject/Picture/Video/Audio N> definition lines so director/lighting
    # prose can live in detailed_description where it belongs.
    global_block = _STORYBOARD_HEADER_RE.sub("", global_block)
    global_block = _SUBJECT_HEADER_RE.sub("", global_block).strip()

    sections, leftover = _split_official_sections(global_block)
    subject_text = sections.get("subject_definitions", "").strip()

    # When the source was a loose AI prompt, lift obvious asset/subject
    # definitions into subject_definitions and keep the remaining global prose as
    # the detailed_description intro (camera language, lighting, director notes).
    if not subject_text:
        extracted, leftover = _extract_definition_lines(leftover)
        subject_text = extracted

    parts = ["subject_definitions:"]
    if subject_text:
        parts.append(subject_text)

    summary = sections.get("summary", "").strip()
    if summary:
        parts.extend(["summary:", summary])

    retention = sections.get("retention_analysis", "").strip()
    if retention:
        parts.extend(["retention_analysis:", retention])

    parts.append("detailed_description:")
    if leftover:
        parts.append(leftover)
    if detailed_body:
        parts.append(detailed_body)

    return "\n\n".join(parts).strip()


class H3ShotTimeline(io.ComfyNode):
    """Lightweight visual editor for H3 detailed_description and its timeline-adjacent audio fields."""

    @classmethod
    def define_schema(cls):
        asset_template = io.Autogrow.TemplatePrefix(
            input=io.AnyType.Input(
                "asset",
                display_name="参考",
                tooltip="可连接 IMAGE / VIDEO / AUDIO；前端使用一个多路参考入口管理这些连接。",
            ),
            prefix="asset",
            # References are optional. The frontend uses a virtual multi-input and
            # only serializes transport inputs for references that are actually connected.
            min=0,
        )

        return io.Schema(
            node_id="TerryH3ShotTimeline",
            display_name="Terry | H3 镜头时间轴",
            category="Terry Toolbox/Text",
            search_aliases=[
                "H3 timeline",
                "H3 shot timeline",
                "MiniMax timeline",
                "镜头时间轴",
                "detailed_description",
            ],
            description=(
                "轻量编辑 MiniMax H3 的 detailed_description：支持多路参考素材、标签化镜头描述、"
                "镜头增删/排序/拖动接缝调时长，以及可选 overall_soundscape / non_diegetic_music。"
            ),
            inputs=[
                io.String.Input(
                    "compiled_prompt",
                    display_name="H3 时间轴原文",
                    multiline=True,
                    default="detailed_description:\n",
                ),
                io.Int.Input(
                    "duration",
                    display_name="总时长",
                    default=15,
                    min=1,
                    max=30,
                    step=1,
                ),
                io.String.Input(
                    "timeline_state",
                    display_name="时间轴状态",
                    multiline=True,
                    default="",
                ),
                io.Autogrow.Input("assets", template=asset_template),
            ],
            outputs=[
                io.String.Output("prompt", display_name="H3 Timeline Prompt"),
            ],
        )

    @classmethod
    def execute(
        cls,
        compiled_prompt: str,
        duration: int = 15,
        timeline_state: str = "",
        assets: io.Autogrow.Type | None = None,
        **asset_inputs,
    ) -> io.NodeOutput:
        # ComfyUI 0.33 normalizes Autogrow.TemplatePrefix inputs as flat
        # keyword arguments (asset1, asset2, ...), rather than necessarily
        # passing a single `assets` mapping. These references are transport-only
        # for this node, so accepting both forms keeps execution compatible.
        _ = assets, asset_inputs, duration, timeline_state

        # The browser owns the visual editing state. At execution time normalize
        # its loose/global representation back to the canonical H3 section order.
        return io.NodeOutput(_restore_official_h3(compiled_prompt))
