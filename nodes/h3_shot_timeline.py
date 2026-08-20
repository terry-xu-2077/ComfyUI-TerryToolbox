from __future__ import annotations

from comfy_api.latest import io


class H3ShotTimeline(io.ComfyNode):
    """Simple visual timeline for the H3 detailed_description section."""

    @classmethod
    def define_schema(cls):
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
                "将 MiniMax H3 的 detailed_description 独立为简易镜头时间轴。"
                "支持增删镜头、拖动镜头接缝调整时长，总时长默认 15 秒、最大 30 秒。"
            ),
            inputs=[
                io.String.Input(
                    "detailed_description",
                    display_name="detailed_description",
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
            ],
            outputs=[
                io.String.Output("detailed_description", display_name="detailed_description"),
            ],
        )

    @classmethod
    def execute(
        cls,
        detailed_description: str,
        duration: int = 15,
        timeline_state: str = "",
    ) -> io.NodeOutput:
        # The browser editor owns the timeline state and continuously compiles it
        # back into standards-compliant H3 plaintext. The backend deliberately
        # stays dumb so the output can be used anywhere a normal STRING is used.
        text = str(detailed_description or "").strip()
        if not text:
            text = "detailed_description:"
        if not text.lower().startswith("detailed_description:"):
            text = f"detailed_description:\n{text}"
        return io.NodeOutput(text)
