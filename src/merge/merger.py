import logging
from pathlib import Path

from src.tools import get_jar
from src.utils import run_cmd

log = logging.getLogger(__name__)


def is_split_apk(file_path: Path) -> bool:
    suffix = file_path.suffix.lower()
    return suffix in (".xapk", ".apks", ".apkm")


def merge_split_apk(input_path: Path, output_dir: Path) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{input_path.stem}.apk"

    apk_editor = get_jar("APKEditor")

    cmd = [
        "java",
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
    if result.returncode != 0:
        log.warning("APKEditor merge failed: %s", result.stderr)
        return _try_justapk_merge(input_path, output_dir)

    return output_path


def _try_justapk_merge(input_path: Path, output_dir: Path) -> Path:
    import subprocess

    cmd = ["python3", "-m", "justapk", "convert", str(input_path), "-o", str(output_dir)]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if result.returncode != 0:
        raise RuntimeError(f"justapk merge failed: {result.stderr}")

    apk_files = list(output_dir.glob("*.apk"))
    if apk_files:
        return apk_files[0]

    raise RuntimeError("justapk merge produced no APK file")


def sign_apk(apk_path: Path) -> Path:
    uber_apk_signer = get_jar("uber-apk-signer")

    keystore_path = Path("fdroid/keystore.p12")
    if not keystore_path.exists():
        log.warning("Keystore not found, skipping signing")
        return apk_path

    import os

    password = os.environ.get("KEYSTORE_PASSWORD", "")

    cmd = [
        "java",
        "-jar",
        str(uber_apk_signer),
        "--apks",
        str(apk_path),
        "--ks",
        str(keystore_path),
        "--ksAlias",
        "repokey",
        "--ksPass",
        f"pass:{password}",
        "--ksKeyPass",
        f"pass:{password}",
        "--allowResign",
    ]

    result = run_cmd(cmd, check=False)
    if result.returncode != 0:
        log.warning("Signing failed: %s", result.stderr)
        return apk_path

    signed_path = apk_path.parent / f"{apk_path.stem}-aligned-debugSigned.apk"
    if signed_path.exists():
        signed_path.rename(apk_path)
        return apk_path

    return apk_path
