from __future__ import annotations

from comfy_api.latest import io


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

        # The browser owns the visual state and continuously compiles it back to
        # standards-compliant H3 plaintext.
        text = str(compiled_prompt or "").strip()
        if not text:
            text = "detailed_description:"
        if "detailed_description:" not in text.lower():
            text = f"detailed_description:\n{text}"
        return io.NodeOutput(text)
