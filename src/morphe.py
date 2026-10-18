import json
import logging
import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any

import httpx

from src.config import AppConfig, PatchOptionOverride, VariantConfig
from src.icons import generate_morphe_custom_icon_dir, generate_original_youtube_icon
from src.tools import TOOLS_DIR, get_tool

log = logging.getLogger(__name__)

CACHE_DIR = Path(".cache/morphe")


def _github_headers() -> dict[str, str]:
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "relevance-pipeline"}
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def _parse_semver_key(ver: str) -> tuple[int, ...]:
    nums = [int(part) for part in re.findall(r"\d+", ver)]
    return tuple(nums) if nums else (0,)


def ensure_morphe_cli() -> Path:
    TOOLS_DIR.mkdir(parents=True, exist_ok=True)
    for candidate in [
        TOOLS_DIR / "morphe-desktop.jar",
        CACHE_DIR / "morphe-desktop.jar",
    ]:
        if candidate.exists() and candidate.stat().st_size > 1_000_000:
            return candidate

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    dest = CACHE_DIR / "morphe-desktop.jar"

    api_url = "https://api.github.com/repos/MorpheApp/morphe-desktop/releases/latest"
    resp = httpx.get(api_url, headers=_github_headers(), timeout=30, follow_redirects=True)
    resp.raise_for_status()
    release = resp.json()

    download_url: str | None = None
    for asset in release.get("assets", []):
        name = asset.get("name", "")
        if name.endswith("-all.jar") or (name.endswith(".jar") and not name.endswith(".asc")):
            download_url = asset.get("browser_download_url")
            break

    if not download_url:
        raise RuntimeError("Could not find morphe-desktop JAR asset in latest release")

    with httpx.stream(
        "GET", download_url, headers=_github_headers(), follow_redirects=True, timeout=180
    ) as r:
        r.raise_for_status()
        with open(dest, "wb") as f:
            for chunk in r.iter_bytes(65536):
                f.write(chunk)

    return dest


def ensure_morphe_patches(repo: str = "MorpheApp/morphe-patches") -> tuple[Path, Path, str]:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    slug = repo.replace("/", "_")

    patches_list_path = CACHE_DIR / f"{slug}_patches-list.json"
    bundle_info_url = f"https://raw.githubusercontent.com/{repo}/main/patches-bundle.json"
    list_raw_url = f"https://raw.githubusercontent.com/{repo}/main/patches-list.json"

    bundle_resp = httpx.get(bundle_info_url, timeout=30, follow_redirects=True)
    bundle_resp.raise_for_status()
    bundle_info = bundle_resp.json()

    patches_version = str(bundle_info.get("version", "latest"))
    mpp_download_url = bundle_info.get("download_url")

    if not mpp_download_url:
        api_url = f"https://api.github.com/repos/{repo}/releases/latest"
        rel_resp = httpx.get(api_url, headers=_github_headers(), timeout=30, follow_redirects=True)
        rel_resp.raise_for_status()
        rel = rel_resp.json()
        patches_version = str(rel.get("tag_name", "latest")).lstrip("v")
        for asset in rel.get("assets", []):
            if asset.get("name", "").endswith(".mpp"):
                mpp_download_url = asset.get("browser_download_url")
                break

    if not mpp_download_url:
        raise RuntimeError(f"No .mpp download URL found for {repo}")

    mpp_path = CACHE_DIR / f"{slug}_patches-{patches_version}.mpp"
    if not mpp_path.exists() or mpp_path.stat().st_size < 10_000:
        with httpx.stream(
            "GET", mpp_download_url, headers=_github_headers(), follow_redirects=True, timeout=180
        ) as r:
            r.raise_for_status()
            with open(mpp_path, "wb") as f:
                for chunk in r.iter_bytes(65536):
                    f.write(chunk)

    list_resp = httpx.get(list_raw_url, timeout=30, follow_redirects=True)
    list_resp.raise_for_status()
    patches_list_path.write_text(list_resp.text, encoding="utf-8")

    return mpp_path, patches_list_path, patches_version


def get_morphe_supported_versions(
    patches_list_path: Path,
    package_id: str,
    include_experimental: bool = False,
) -> dict[str, dict[str, Any]]:
    data = json.loads(patches_list_path.read_text(encoding="utf-8"))
    versions: dict[str, dict[str, Any]] = {}

    for patch in data.get("patches", []):
        if not patch.get("default", True):
            continue
        compat_pkgs = patch.get("compatiblePackages") or []
        for cp in compat_pkgs:
            if cp.get("packageName") != package_id:
                continue
            for target in cp.get("targets") or []:
                ver = target.get("version")
                if not ver:
                    continue
                is_exp = bool(target.get("isExperimental", False))
                if is_exp and not include_experimental:
                    continue
                entry = versions.setdefault(
                    ver,
                    {
                        "version": ver,
                        "patch_count": 0,
                        "is_experimental": is_exp,
                        "min_sdk": target.get("minSdk"),
                    },
                )
                entry["patch_count"] += 1

    return dict(
        sorted(
            versions.items(),
            key=lambda kv: (kv[1]["patch_count"], _parse_semver_key(kv[0])),
            reverse=True,
        )
    )


def get_apkpure_available_versions(package_id: str) -> list[str]:
    try:
        apkeep = get_tool("apkeep")
    except FileNotFoundError:
        log.warning("apkeep not found when listing versions for %s", package_id)
        return []

    cmd = [str(apkeep), "-l", "-a", package_id, "-d", "apk-pure"]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=60, check=False)
    except Exception as e:
        log.warning("apkeep -l failed for %s: %s", package_id, e)
        return []

    versions: list[str] = []
    for line in res.stdout.splitlines():
        if line.strip().startswith("|"):
            raw = line.strip().lstrip("|").strip()
            for item in raw.split(","):
                v = item.strip()
                if v and not v.endswith("-SECONDARY") and "does not make" not in v:
                    versions.append(v)
    return versions


def resolve_best_version(
    package_id: str,
    patches_list_path: Path,
    include_experimental: bool = False,
) -> dict[str, Any]:
    supported = get_morphe_supported_versions(
        patches_list_path=patches_list_path,
        package_id=package_id,
        include_experimental=include_experimental,
    )
    if not supported:
        raise RuntimeError(f"No Morphe-supported versions found for {package_id}")

    apkpure_versions = get_apkpure_available_versions(package_id)
    apkpure_set = set(apkpure_versions)

    available_supported = [
        info for ver, info in supported.items() if not apkpure_set or ver in apkpure_set
    ]
    if not available_supported:
        available_supported = list(supported.values())

    available_supported.sort(
        key=lambda x: (x["patch_count"], _parse_semver_key(x["version"])),
        reverse=True,
    )
    chosen = available_supported[0]
    return {
        "package_id": package_id,
        "recommended_version": chosen["version"],
        "patch_count": chosen["patch_count"],
        "is_experimental": chosen["is_experimental"],
        "all_morphe_supported_versions": list(supported.keys()),
        "available_on_apkpure": [v["version"] for v in available_supported],
    }


def resign_apk_with_keystore(apk_path: Path, keystore_path: Path, password: str) -> Path:
    zipalign = shutil.which("zipalign")
    apksigner = shutil.which("apksigner")
    if not zipalign or not apksigner or not keystore_path.exists():
        return apk_path

    aligned_path = apk_path.with_suffix(".aligned.apk")
    subprocess.run([zipalign, "-f", "-p", "4", str(apk_path), str(aligned_path)], check=True)
    shutil.move(str(aligned_path), str(apk_path))

    subprocess.run(
        [
            apksigner,
            "sign",
            "--ks",
            str(keystore_path),
            "--ks-pass",
            f"pass:{password}",
            "--ks-key-alias",
            "repokey",
            "--key-pass",
            f"pass:{password}",
            str(apk_path),
        ],
        check=True,
    )
    return apk_path


def patch_variant(
    input_apk: Path,
    app: AppConfig,
    variant: VariantConfig,
    mpp_path: Path,
    work_dir: Path,
    keystore_path: Path | None = None,
    keystore_password: str = "",
) -> tuple[Path, Path, dict[str, Any]]:
    morphe_cli = ensure_morphe_cli()
    variant_dir = work_dir / variant.id
    variant_dir.mkdir(parents=True, exist_ok=True)

    output_apk = variant_dir / f"{variant.package_name}.apk"
    result_json = variant_dir / "patching-result.json"
    temp_dir = variant_dir / "tmp"

    icon_512_path = variant_dir / "icon_512.png"

    cmd: list[str] = [
        "java",
        "-Xmx4g",
        "-jar",
        str(morphe_cli.resolve()),
        "patch",
        "-p",
        str(mpp_path.resolve()),
    ]

    default_morphe_pkg = (
        "app.morphe.android.youtube"
        if app.package_id == "com.google.android.youtube"
        else f"{app.package_id}.morphe"
    )
    if variant.package_name != default_morphe_pkg:
        cmd.extend(
            [
                "-e",
                "Clone app",
                f"-OpackageName={variant.package_name}",
            ]
        )

    if app.package_id == "com.google.android.youtube":
        if variant.icon.type == "youtube_flag":
            icon_dir = variant_dir / "custom_icon"
            generate_morphe_custom_icon_dir(
                output_dir=icon_dir,
                country=variant.icon.country,
                stripes=variant.icon.stripes,
            )
            shutil.copy2(icon_dir / "icon_512.png", icon_512_path)
            cmd.extend(
                [
                    "-e",
                    "Custom branding",
                    f"-OcustomName={variant.name}",
                    "-OappIcon=custom",
                    f"-OcustomIcon={icon_dir.resolve()}",
                ]
            )
        else:
            generate_original_youtube_icon(icon_512_path)
            cmd.extend(
                [
                    "-e",
                    "Custom branding",
                    f"-OcustomName={variant.name}",
                    "-OappIcon=original",
                ]
            )

    overrides: list[PatchOptionOverride] = []
    if isinstance(app.patches, PatchOptionOverride):
        overrides.append(app.patches)
    overrides.append(variant.patches)

    for ov in overrides:
        for patch_name in ov.enable:
            cmd.extend(["-e", patch_name])
            for opt_key, opt_val in ov.options.get(patch_name, {}).items():
                cmd.append(f"-O{opt_key}={opt_val}")
        for patch_name in ov.disable:
            cmd.extend(["-d", patch_name])

    if keystore_path and keystore_path.exists():
        cmd.extend(
            [
                "--keystore",
                str(keystore_path.resolve()),
                "--keystore-password",
                keystore_password,
                "--keystore-entry-alias",
                "repokey",
                "--keystore-entry-password",
                keystore_password,
            ]
        )

    cmd.extend(
        [
            "-r",
            str(result_json.resolve()),
            "-t",
            str(temp_dir.resolve()),
            "-o",
            str(output_apk.resolve()),
            str(input_apk.resolve()),
        ]
    )

    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=1200, check=False)
    if proc.returncode != 0 or not output_apk.exists():
        tail_err = (proc.stderr or "")[-1500:]
        tail_out = (proc.stdout or "")[-1500:]
        raise RuntimeError(
            f"Morphe patching failed for {variant.name} ({variant.package_name}):\n"
            f"STDOUT:\n{tail_out}\nSTDERR:\n{tail_err}"
        )

    if keystore_path and keystore_path.exists():
        resign_apk_with_keystore(output_apk, keystore_path, keystore_password)

    report: dict[str, Any] = {}
    if result_json.exists():
        try:
            report = json.loads(result_json.read_text(encoding="utf-8"))
        except Exception:
            report = {}

    return output_apk, icon_512_path, report
