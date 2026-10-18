import logging
import os
import re
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any

import httpx

log = logging.getLogger(__name__)

CACHE_DIR = Path(".cache/microg")


def _adb_cmd(*args: str, timeout: int = 120) -> subprocess.CompletedProcess[str]:
    adb = shutil.which("adb")
    if not adb:
        android_home = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT") or ""
        candidate = Path(android_home) / "platform-tools" / "adb"
        if candidate.exists():
            adb = str(candidate)
        else:
            raise FileNotFoundError("adb not found in PATH or ANDROID_HOME/platform-tools")
    return subprocess.run(
        [adb, *args], capture_output=True, text=True, timeout=timeout, check=False
    )


def wait_for_emulator(timeout_seconds: int = 300) -> None:
    _adb_cmd("wait-for-device", timeout=timeout_seconds)
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        res = _adb_cmd("shell", "getprop", "sys.boot_completed", timeout=15)
        if res.stdout.strip() == "1":
            _adb_cmd(
                "shell", "settings", "put", "global", "window_animation_scale", "0", timeout=15
            )
            _adb_cmd(
                "shell", "settings", "put", "global", "transition_animation_scale", "0", timeout=15
            )
            _adb_cmd(
                "shell", "settings", "put", "global", "animator_duration_scale", "0", timeout=15
            )
            _adb_cmd("shell", "input", "keyevent", "82", timeout=15)
            return
        time.sleep(3)
    raise TimeoutError("Timed out waiting for Android Emulator to finish booting")


def ensure_microg_installed() -> Path | None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cached = list(CACHE_DIR.glob("*.apk"))
    apk_path: Path | None = cached[0] if cached else None

    if not apk_path:
        headers = {"Accept": "application/vnd.github+json", "User-Agent": "relevance-pipeline"}
        token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
        if token:
            headers["Authorization"] = f"Bearer {token}"
        try:
            resp = httpx.get(
                "https://api.github.com/repos/MorpheApp/MicroG-RE/releases/latest",
                headers=headers,
                timeout=30,
                follow_redirects=True,
            )
            resp.raise_for_status()
            release = resp.json()
            for asset in release.get("assets", []):
                name = asset.get("name", "")
                if name.endswith(".apk") and "hw" not in name.lower():
                    dest = CACHE_DIR / name
                    with httpx.stream(
                        "GET",
                        asset["browser_download_url"],
                        headers=headers,
                        follow_redirects=True,
                        timeout=120,
                    ) as r:
                        r.raise_for_status()
                        with open(dest, "wb") as f:
                            for chunk in r.iter_bytes(65536):
                                f.write(chunk)
                    apk_path = dest
                    break
        except Exception as e:
            log.warning("Could not fetch MicroG-RE: %s", e)
            return None

    if apk_path and apk_path.exists():
        res = _adb_cmd("install", "-r", "-g", str(apk_path), timeout=180)
        if res.returncode != 0:
            log.warning("MicroG-RE install returned %s: %s", res.returncode, res.stderr)
    return apk_path


def extract_package_name(apk_path: Path) -> str:
    for tool_name in ("apkanalyzer", "aapt2", "aapt"):
        tool = shutil.which(tool_name)
        if not tool:
            android_home = (
                os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT") or ""
            )
            if android_home:
                matches = list(Path(android_home).rglob(tool_name))
                if matches:
                    tool = str(matches[0])
        if tool:
            if tool_name == "apkanalyzer":
                res = subprocess.run(
                    [tool, "manifest", "application-id", str(apk_path)],
                    capture_output=True,
                    text=True,
                    check=False,
                )
                if res.returncode == 0 and res.stdout.strip():
                    return res.stdout.strip()
            else:
                res = subprocess.run(
                    [tool, "dump", "badging", str(apk_path)],
                    capture_output=True,
                    text=True,
                    check=False,
                )
                m = re.search(r"package:\s+name='([^']+)'", res.stdout)
                if m:
                    return m.group(1)

    stem = apk_path.stem
    return re.sub(r"_\d+$", "", stem)


def verify_apks_on_emulator(apk_paths: list[Path]) -> dict[str, Any]:
    wait_for_emulator()
    ensure_microg_installed()

    results: list[dict[str, Any]] = []
    installed_packages: list[str] = []

    for apk_path in apk_paths:
        pkg = extract_package_name(apk_path)
        install_res = _adb_cmd("install", "-r", "-g", str(apk_path.resolve()), timeout=300)
        install_output = (install_res.stdout + "\n" + install_res.stderr).strip()
        install_ok = install_res.returncode == 0 and "Success" in install_output

        if not install_ok:
            raise RuntimeError(
                f"Emulator APK install failed for {apk_path.name} ({pkg}): {install_output}"
            )

        pm_res = _adb_cmd("shell", "pm", "list", "packages", pkg, timeout=30)
        if f"package:{pkg}" not in pm_res.stdout:
            raise RuntimeError(f"Package {pkg} not found in pm list packages after install")

        _adb_cmd("logcat", "-c", timeout=15)
        launch_res = _adb_cmd(
            "shell",
            "monkey",
            "-p",
            pkg,
            "-c",
            "android.intent.category.LAUNCHER",
            "1",
            timeout=60,
        )
        time.sleep(4)

        pid_res = _adb_cmd("shell", "pidof", pkg, timeout=15)
        logcat_res = _adb_cmd("logcat", "-d", "-v", "brief", timeout=30)

        fatal_lines = [
            line
            for line in logcat_res.stdout.splitlines()
            if "FATAL EXCEPTION" in line or (f"Process: {pkg}" in line and "AndroidRuntime" in line)
        ]

        installed_packages.append(pkg)
        results.append(
            {
                "apk": apk_path.name,
                "package_name": pkg,
                "installed": True,
                "launched": launch_res.returncode == 0,
                "pid": pid_res.stdout.strip(),
                "fatal_exceptions": fatal_lines,
            }
        )

        _adb_cmd("shell", "am", "force-stop", pkg, timeout=15)

    all_pm = _adb_cmd("shell", "pm", "list", "packages", timeout=30).stdout
    coexisting = [pkg for pkg in installed_packages if f"package:{pkg}" in all_pm]
    if len(coexisting) != len(installed_packages):
        raise RuntimeError(
            f"Not all variants coexist simultaneously on device! "
            f"Expected {installed_packages}, found {coexisting}"
        )

    return {
        "emulator_verified": True,
        "side_by_side_count": len(coexisting),
        "coexisting_packages": coexisting,
        "results": results,
    }
