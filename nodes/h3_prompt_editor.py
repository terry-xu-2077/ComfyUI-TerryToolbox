from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any

import torch
import folder_paths
from comfy_api.latest import io, ui, Types


def _kind(value: Any) -> str:
    if isinstance(value, dict) and "waveform" in value:
        return "audio"
    if isinstance(value, torch.Tensor) and value.ndim == 4 and value.shape[-1] in (1, 3, 4):
        return "picture"
    if hasattr(value, "save_to") and hasattr(value, "get_dimensions"):
        return "video"
    return "other"


class H3PromptEditor(io.ComfyNode):
    """Visual MiniMax H3 prompt editor; output is always raw H3 plaintext."""

    @classmethod
    def define_schema(cls):
        asset_template = io.Autogrow.TemplatePrefix(
            input=io.AnyType.Input(
                "asset",
                display_name="参考",
                tooltip="可连接 IMAGE / VIDEO / AUDIO；连接后自动增加下一个输入。",
            ),
            prefix="asset",
            min=1,
        )

        return io.Schema(
            node_id="TerryH3PromptEditor",
            display_name="Terry | H3 提示词编辑器",
            category="Terry Toolbox/Text",
            search_aliases=["MiniMax H3", "H3 prompt", "H3 提示词", "reference prompt"],
            description=(
                "可视化编写 MiniMax H3 提示词；支持动态数量图片、视频、音频参考；"
                "输出始终为标准 H3 原文 STRING。"
            ),
            inputs=[
                io.String.Input("prompt", display_name="H3 原文", multiline=True, default=""),
                io.Autogrow.Input("assets", template=asset_template),
            ],
            hidden=[io.Hidden.prompt, io.Hidden.extra_pnginfo],
            outputs=[io.String.Output("prompt", display_name="H3 Prompt")],
        )

    @classmethod
    def execute(cls, prompt: str, assets: io.Autogrow.Type) -> io.NodeOutput:
        counts = {"picture": 0, "video": 0, "audio": 0, "other": 0}
        result = []
        temp = Path(folder_paths.get_temp_directory())
        temp.mkdir(parents=True, exist_ok=True)

        for input_name, value in assets.items():
            kind = _kind(value)
            counts[kind] += 1
            idx = counts[kind]
            label = {
                "picture": f"Picture {idx}",
                "video": f"Video {idx}",
                "audio": f"Audio {idx}",
            }.get(kind, f"Asset {idx}")
            item = {"input_name": input_name, "kind": kind, "index": idx, "label": label}

            try:
                if kind == "picture":
                    saved = ui.ImageSaveHelper.save_images(
                        value[:1],
                        filename_prefix=f".terry_h3/{uuid.uuid4().hex}",
                        folder_type=io.FolderType.temp,
                        cls=cls,
                        compress_level=2,
                    )
                    if saved:
                        s = saved[0]
                        item.update(filename=s.filename, subfolder=s.subfolder, folder_type="temp")

                elif kind == "video":
                    filename = f"terry_h3_{uuid.uuid4().hex}.mp4"
                    value.save_to(
                        str(temp / filename),
                        format=Types.VideoContainer("mp4"),
                        codec=Types.VideoCodec("auto"),
                    )
                    item.update(filename=filename, subfolder="", folder_type="temp")

                elif kind == "audio":
                    sr = value.get("sample_rate", value.get("sampler_rate", 0))
                    waveform = value.get("waveform")
                    if sr:
                        item["sample_rate"] = int(sr)
                    if waveform is not None and sr:
                        try:
                            item["duration"] = float(waveform.shape[-1]) / float(sr)
                        except Exception:
                            pass
            except Exception as exc:
                item["preview_error"] = str(exc)

            result.append(item)

        return io.NodeOutput(prompt, ui={"terry_h3_assets": result})
