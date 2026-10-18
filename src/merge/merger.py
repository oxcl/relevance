import logging
import subprocess
from pathlib import Path

from src.tools import get_jar
from src.utils import run_cmd

log = logging.getLogger(__name__)


def is_split_apk(file_path: Path) -> bool:
    suffix = file_path.suffix.lower()
    return suffix in (".xapk", ".apks", ".apkm")


def merge_split_apk(input_path: Path, output_dir: Path) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{input_path.stem}-merged.apk"
    if output_path.exists() and output_path.stat().st_size > 1_000_000:
        return output_path

    apk_editor = get_jar("APKEditor")

    cmd = [
        "java",
        "-Xmx4g",
        "-jar",
        str(apk_editor),
        "m",
        "-i",
        str(input_path),
        "-o",
        str(output_path),
        "-f",
    ]

    result = run_cmd(cmd, check=False)
    if result.returncode != 0 or not output_path.exists():
        log.warning("APKEditor merge failed: %s", result.stderr)
        return _try_justapk_merge(input_path, output_dir)

    return output_path


def _try_justapk_merge(input_path: Path, output_dir: Path) -> Path:
    cmd = ["python3", "-m", "justapk", "convert", str(input_path), "-o", str(output_dir)]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    if result.returncode != 0:
        raise RuntimeError(f"justapk merge failed: {result.stderr}")

    apk_files = list(output_dir.glob("*.apk"))
    if apk_files:
        return apk_files[0]

    raise RuntimeError("justapk merge produced no APK file")
