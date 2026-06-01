import os
import shutil
from pathlib import Path

TOOLS_DIR = Path(os.environ.get("RELEVANCE_TOOLS_DIR", ".tools"))


def get_tool(name: str) -> Path:
    system = shutil.which(name)
    if system:
        return Path(system)

    tool_path = TOOLS_DIR / name
    if tool_path.exists():
        return tool_path

    jar_path = TOOLS_DIR / f"{name}.jar"
    if jar_path.exists():
        return jar_path

    raise FileNotFoundError(
        f"Tool '{name}' not found in PATH or {TOOLS_DIR}. "
        f"Set RELEVANCE_TOOLS_DIR or install the tool."
    )


def get_jar(name: str) -> Path:
    jar_path = TOOLS_DIR / f"{name}.jar"
    if jar_path.exists():
        return jar_path

    raise FileNotFoundError(
        f"JAR '{name}' not found at {jar_path}. "
        f"Set RELEVANCE_TOOLS_DIR or download the tool."
    )
