from comfy_api.latest import ComfyExtension, io
from typing_extensions import override

from .nodes import EnhancedFileSave, VideoCompare, H3PromptEditor

WEB_DIRECTORY = "./web"


class TerryToolboxExtension(ComfyExtension):
    """
    Terry Toolbox root extension.

    Future custom nodes should be imported from ./nodes and appended to
    get_node_list(), so the whole toolbox remains one installable package.
    """

    @override
    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        return [
            EnhancedFileSave,
            VideoCompare,
            H3PromptEditor,
        ]


async def comfy_entrypoint() -> TerryToolboxExtension:
    return TerryToolboxExtension()


__all__ = ["comfy_entrypoint"]
