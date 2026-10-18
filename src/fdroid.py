import base64
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

import yaml

from src.config import Settings, VariantConfig
from src.utils import run_cmd


def decode_keystore(output_dir: Path) -> Path:
    keystore_b64 = os.environ.get("KEYSTORE_BASE64")
    if not keystore_b64:
        raise ValueError("KEYSTORE_BASE64 environment variable not set")

    fdroid_dir = Path(output_dir).parent
    fdroid_dir.mkdir(parents=True, exist_ok=True)

    keystore_path = fdroid_dir / "keystore.p12"
    keystore_bytes = base64.b64decode(keystore_b64.strip())
    keystore_path.write_bytes(keystore_bytes)

    return keystore_path


def generate_fdroid_config(settings: Settings, keystore_path: Path) -> Path:
    fdroid_dir = Path(settings.output_dir).parent
    fdroid_dir.mkdir(parents=True, exist_ok=True)

    repo_logo = Path("assets/logo-512.png")
    if repo_logo.exists():
        shutil.copy2(repo_logo, fdroid_dir / "icon.png")

    password = os.environ.get("KEYSTORE_PASSWORD", "")
    repo_url = settings.repo_url.rstrip("/")
    fdroid_repo_url = repo_url if repo_url.endswith("/repo") else f"{repo_url}/repo"

    config = {
        "repo_url": fdroid_repo_url,
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
    with open(config_path, "w", encoding="utf-8") as f:
        yaml.dump(config, f, default_flow_style=False)
    os.chmod(config_path, 0o600)

    return config_path


def write_variant_metadata(
    output_dir: Path,
    variant: VariantConfig,
    base_app_name: str,
    version: str,
    patches_version: str,
    icon_512_path: Path | None = None,
) -> None:
    fdroid_dir = Path(output_dir).parent
    metadata_dir = fdroid_dir / "metadata"
    metadata_dir.mkdir(parents=True, exist_ok=True)

    meta_file = metadata_dir / f"{variant.package_name}.yml"
    country_note = (
        f" ({variant.icon.country} flag edition)"
        if variant.icon.type == "youtube_flag" and variant.icon.country
        else ""
    )
    meta_data: dict[str, Any] = {
        "AuthorName": "Morphe",
        "Categories": ["Internet", "Multimedia"],
        "License": "GPL-3.0-only",
        "Name": variant.name,
        "AutoName": variant.name,
        "Summary": f"{variant.name} patched with Morphe v{patches_version}{country_note}",
        "Description": (
            f"{variant.name} (v{version}) patched automatically using official Morphe Patches "
            f"(v{patches_version}).\n\n"
            f"- Package ID: {variant.package_name}\n"
            f"- Base Application: {base_app_name} v{version}\n"
            f"- Side-by-side installable alongside other YouTube variants\n"
        ),
        "SourceCode": "https://github.com/MorpheApp/morphe-patches",
        "IssueTracker": "https://github.com/oxcl/relevance/issues",
    }
    with open(meta_file, "w", encoding="utf-8") as f:
        yaml.dump(meta_data, f, default_flow_style=False, sort_keys=False, allow_unicode=True)

    if icon_512_path and icon_512_path.exists():
        locale_dir = metadata_dir / variant.package_name / "en-US"
        locale_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(icon_512_path, locale_dir / "icon.png")

        repo_icons_dir = Path(output_dir) / "icons"
        repo_icons_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(icon_512_path, repo_icons_dir / f"{variant.package_name}.png")


def add_nojekyll(repo_dir: Path) -> None:
    repo_dir.mkdir(parents=True, exist_ok=True)
    nojekyll = repo_dir / ".nojekyll"
    if not nojekyll.exists():
        nojekyll.write_text("")


def run_fdroid_update(settings: Settings) -> None:
    repo_dir = Path(settings.output_dir)
    nojekyll = repo_dir / ".nojekyll"
    if nojekyll.exists():
        nojekyll.unlink()

    pipeline_files = ["state.json", "patch-browser.html"]
    moved_files: list[tuple[Path, Path]] = []
    for name in pipeline_files:
        source = repo_dir / name
        if source.exists():
            backup = repo_dir.parent / f".{name}.pipeline"
            shutil.move(str(source), str(backup))
            moved_files.append((source, backup))

    try:
        script_path = Path("scripts/fdroid_update.py").resolve()
        if script_path.exists():
            env = os.environ.copy()
            env["RELEVANCE_REPO_URL"] = settings.repo_url.rstrip("/")
            proc = subprocess.run(
                [sys.executable, str(script_path)],
                capture_output=True,
                text=True,
                check=False,
                env=env,
            )
            if proc.returncode != 0:
                raise RuntimeError(
                    f"fdroid update failed ({proc.returncode}):\n{proc.stdout}\n{proc.stderr}"
                )
        else:
            fdroid_dir = repo_dir.parent
            result = run_cmd(["fdroid", "update", "--create-metadata"], cwd=fdroid_dir, check=False)
            if result.returncode != 0:
                raise RuntimeError(f"fdroid update failed: {result.stderr}")
    finally:
        for source, backup in moved_files:
            if backup.exists():
                shutil.move(str(backup), str(source))

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
            return line.split("SHA256:")[1].strip().replace(":", "")
    return "unknown"


def version_retention(repo_dir: Path, keep_versions: int) -> int:
    apk_files = list(repo_dir.glob("*.apk"))
    by_package: dict[str, list[tuple[str, Path]]] = {}

    for apk in apk_files:
        name = apk.stem
        match = re.match(r"^(.+?)_(\d+)$", name)
        if match:
            pkg = match.group(1)
            ver = match.group(2)
            by_package.setdefault(pkg, []).append((ver, apk))
        else:
            by_package.setdefault(name, []).append((name, apk))

    removed = 0
    for _pkg, versions in by_package.items():
        if len(versions) <= keep_versions:
            continue
        versions.sort(key=lambda x: x[1].stat().st_mtime, reverse=True)
        for _, path in versions[keep_versions:]:
            path.unlink()
            removed += 1

    return removed
