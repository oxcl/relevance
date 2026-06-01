import base64
import os
import re
from pathlib import Path

import yaml

from src.config import Settings
from src.utils import run_cmd


def decode_keystore(output_dir: Path) -> Path:
    keystore_b64 = os.environ.get("KEYSTORE_BASE64")
    if not keystore_b64:
        raise ValueError("KEYSTORE_BASE64 environment variable not set")

    fdroid_dir = Path(output_dir).parent
    fdroid_dir.mkdir(parents=True, exist_ok=True)

    keystore_path = fdroid_dir / "keystore.p12"

    keystore_bytes = base64.b64decode(keystore_b64)
    with open(keystore_path, "wb") as f:
        f.write(keystore_bytes)

    return keystore_path


def generate_fdroid_config(settings: Settings, keystore_path: Path) -> Path:
    fdroid_dir = Path(settings.output_dir).parent
    fdroid_dir.mkdir(parents=True, exist_ok=True)

    password = os.environ.get("KEYSTORE_PASSWORD", "")

    config = {
        "repo_url": "https://oxcl.github.io/relevance/repo",
        "repo_name": settings.repo_name,
        "repo_description": settings.repo_description,
        "repo_icon": "icon.png",
        "keystore": "keystore.p12",
        "keystorepass": password,
        "keypass": password,
        "repo_keyalias": "repokey",
        "keydname": "CN=repokey, OU=F-Droid",
        "archive_older": 0,
    }

    config_path = fdroid_dir / "config.yml"
    with open(config_path, "w") as f:
        yaml.dump(config, f, default_flow_style=False)

    return config_path


def add_nojekyll(repo_dir: Path) -> None:
    repo_dir.mkdir(parents=True, exist_ok=True)
    nojekyll = repo_dir / ".nojekyll"
    if not nojekyll.exists():
        nojekyll.write_text("")


def run_fdroid_update(settings: Settings) -> None:
    fdroid_dir = Path(settings.output_dir).parent
    repo_dir = Path(settings.output_dir)

    nojekyll = repo_dir / ".nojekyll"
    if nojekyll.exists() and nojekyll.stat().st_size == 0:
        nojekyll.unlink()

    result = run_cmd(["fdroid", "update", "--create-metadata"], cwd=fdroid_dir, check=False)
    if result.returncode != 0:
        print(f"fdroid update failed: {result.stderr}")

    nojekyll.touch()


def get_repo_fingerprint(keystore_path: Path) -> str:
    password = os.environ.get("KEYSTORE_PASSWORD", "")
    result = run_cmd(
        [
            "keytool",
            "-list",
            "-v",
            "-keystore",
            str(keystore_path),
            "-storetype",
            "pkcs12",
            "-storepass",
            password,
        ],
        check=False,
    )
    if result.returncode != 0:
        return "unknown"

    for line in result.stdout.splitlines():
        if "SHA256:" in line:
            return "SHA256:" + line.split("SHA256:")[1].strip()
    return "unknown"


def version_retention(repo_dir: Path, keep_versions: int) -> int:
    apk_files = list(repo_dir.glob("*.apk"))
    by_package: dict[str, list[tuple[str, Path]]] = {}

    for apk in apk_files:
        name = apk.stem
        match = re.match(r"^(.+?)_(\d+)$", name)
        if match:
            pkg = match.group(1)
            ver = int(match.group(2))
            by_package.setdefault(pkg, []).append((str(ver), apk))
        else:
            by_package.setdefault(name, []).append(("0", apk))

    removed = 0
    for pkg, versions in by_package.items():
        if len(versions) <= keep_versions:
            continue
        versions.sort(key=lambda x: int(x[0]), reverse=True)
        for _, path in versions[keep_versions:]:
            path.unlink()
            removed += 1

    return removed
