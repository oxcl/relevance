import json
import logging
import os
import shutil
import sys
from pathlib import Path
from typing import Any

import click
from rich.console import Console

from src import __version__
from src.cache import (
    compute_config_hash,
    compute_source_hash,
    load_state,
    save_state,
    update_state,
)
from src.config import AppConfig, AppConfigFile, load_config
from src.emulator import verify_apks_on_emulator
from src.fdroid import (
    add_nojekyll,
    decode_keystore,
    generate_fdroid_config,
    get_repo_fingerprint,
    run_fdroid_update,
    version_retention,
    write_variant_metadata,
)
from src.icons import generate_morphe_custom_icon_dir, generate_original_youtube_icon
from src.merge.merger import is_split_apk, merge_split_apk
from src.morphe import (
    ensure_morphe_patches,
    patch_variant,
    resolve_best_version,
)
from src.sources.auto import download_apk
from src.web import generate_landing_page, generate_patch_browser_from_morphe_json

console = Console()
log = logging.getLogger(__name__)


def check_app_update_status(
    app: AppConfig,
    config: AppConfigFile,
    force: bool = False,
) -> dict[str, Any]:
    output_dir = Path(config.settings.output_dir)
    state = load_state(output_dir)

    _mpp_path, patches_list_path, patches_version = ensure_morphe_patches(app.patch_source)
    version_info = resolve_best_version(
        package_id=app.package_id,
        patches_list_path=patches_list_path,
        include_experimental=app.include_experimental,
    )
    rec_version = str(version_info["recommended_version"])
    target_version = app.version if app.version not in ("auto", "latest") else rec_version

    variants = app.effective_variants()
    variant_statuses: list[dict[str, Any]] = []
    any_needs_update = False

    for variant in variants:
        cfg_hash = compute_config_hash(
            {
                "app": app.model_dump(mode="json", exclude={"variants"}),
                "variant": variant.model_dump(mode="json"),
                "patches_version": patches_version,
            }
        )
        prev = state.apps.get(variant.package_name)
        existing_apks = list(output_dir.glob(f"{variant.package_name}_*.apk")) + list(
            output_dir.glob(f"{variant.package_name}.apk")
        )
        up_to_date = (
            not force
            and prev is not None
            and prev.version == target_version
            and prev.config_hash == cfg_hash
            and len(existing_apks) > 0
        )
        if not up_to_date:
            any_needs_update = True

        variant_statuses.append(
            {
                "id": variant.id,
                "name": variant.name,
                "package_name": variant.package_name,
                "previously_patched_version": prev.version if prev else None,
                "target_version": target_version,
                "needs_update": not up_to_date,
            }
        )

    return {
        "name": app.name,
        "package_id": app.package_id,
        "patch_source": app.patch_source,
        "patches_version": patches_version,
        "target_version": target_version,
        "morphe_patch_count": version_info["patch_count"],
        "needs_update": any_needs_update,
        "agent_instructions": app.agent_instructions.strip(),
        "variants": variant_statuses,
    }


def process_app(
    app: AppConfig,
    config: AppConfigFile,
    force: bool,
    dry_run: bool,
    keystore_path: Path | None,
    keystore_password: str,
) -> tuple[bool, list[Path], list[dict[str, str]], Path | None]:
    output_dir = Path(config.settings.output_dir)
    cache_dir = Path(".cache") / app.package_id
    cache_dir.mkdir(parents=True, exist_ok=True)
    state = load_state(output_dir)

    mpp_path, patches_list_path, patches_version = ensure_morphe_patches(app.patch_source)
    version_info = resolve_best_version(
        package_id=app.package_id,
        patches_list_path=patches_list_path,
        include_experimental=app.include_experimental,
    )
    rec_version = str(version_info["recommended_version"])
    target_version = app.version if app.version not in ("auto", "latest") else rec_version
    variants = app.effective_variants()

    console.print(
        f"[cyan]ℹ[/cyan] {app.name} ({app.package_id}): "
        f"Morphe v{patches_version} recommended version [bold]{target_version}[/bold] "
        f"({version_info['patch_count']} default patches)"
    )

    if dry_run:
        for v in variants:
            console.print(
                f"  [cyan]DRY RUN[/cyan] Variant '{v.name}' ({v.package_name}) @ v{target_version}"
            )
        return True, [], [], patches_list_path

    variants_to_build = []
    published_apks: list[Path] = []
    variants_summary: list[dict[str, str]] = []

    for v in variants:
        cfg_hash = compute_config_hash(
            {
                "app": app.model_dump(mode="json", exclude={"variants"}),
                "variant": v.model_dump(mode="json"),
                "patches_version": patches_version,
            }
        )
        prev = state.apps.get(v.package_name)
        existing_apks = sorted(
            list(output_dir.glob(f"{v.package_name}_*.apk"))
            + list(output_dir.glob(f"{v.package_name}.apk")),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        if (
            not force
            and prev is not None
            and prev.version == target_version
            and prev.config_hash == cfg_hash
            and existing_apks
        ):
            console.print(
                f"[green]✓[/green] {v.name} ({v.package_name}): "
                f"already at v{target_version}, skipping"
            )
            icon_512 = cache_dir / "variants" / v.id / "icon_512.png"
            if not icon_512.exists():
                if v.icon.type == "youtube_flag":
                    icon_dir = cache_dir / "variants" / v.id / "custom_icon"
                    generate_morphe_custom_icon_dir(
                        output_dir=icon_dir,
                        country=v.icon.country,
                        stripes=v.icon.stripes,
                    )
                    icon_512 = icon_dir / "icon_512.png"
                else:
                    generate_original_youtube_icon(icon_512)
            write_variant_metadata(
                output_dir=output_dir,
                variant=v,
                base_app_name=app.name,
                version=target_version,
                patches_version=patches_version,
                icon_512_path=icon_512,
            )
            published_apks.append(existing_apks[0])
            variants_summary.append(
                {
                    "name": v.name,
                    "package_name": v.package_name,
                    "version": target_version,
                }
            )
        else:
            variants_to_build.append((v, cfg_hash))

    if not variants_to_build:
        return True, published_apks, variants_summary, patches_list_path

    console.print(
        f"[blue]⟳[/blue] Fetching {app.package_id}@{target_version} via {app.source}..."
    )
    raw_source = download_apk(
        source_type=app.source,
        package_id=app.package_id,
        version=target_version,
        dest=cache_dir / "downloads",
    )
    console.print(f"[green]✓[/green] Downloaded {raw_source.name}")

    base_apk = raw_source
    if is_split_apk(raw_source):
        console.print(f"[yellow]⟳[/yellow] Merging split APK bundle {raw_source.name}...")
        base_apk = merge_split_apk(raw_source, cache_dir / "merged")
        console.print(f"[green]✓[/green] Merged into {base_apk.name}")

    output_dir.mkdir(parents=True, exist_ok=True)
    version_slug = target_version.replace(".", "")

    for v, cfg_hash in variants_to_build:
        console.print(f"[blue]⟳[/blue] Patching variant '{v.name}' ({v.package_name})...")
        patched_apk, icon_512, _report = patch_variant(
            input_apk=base_apk,
            app=app,
            variant=v,
            mpp_path=mpp_path,
            work_dir=cache_dir / "variants",
            keystore_path=keystore_path,
            keystore_password=keystore_password,
        )

        dest_apk = output_dir / f"{v.package_name}_{version_slug}.apk"
        shutil.copy2(patched_apk, dest_apk)

        write_variant_metadata(
            output_dir=output_dir,
            variant=v,
            base_app_name=app.name,
            version=target_version,
            patches_version=patches_version,
            icon_512_path=icon_512,
        )

        apk_hash = compute_source_hash(dest_apk)
        update_state(state, v.package_name, apk_hash, cfg_hash, target_version)
        save_state(output_dir, state)

        published_apks.append(dest_apk)
        variants_summary.append(
            {
                "name": v.name,
                "package_name": v.package_name,
                "version": target_version,
            }
        )
        console.print(f"[green]✓[/green] Published {v.name} → {dest_apk.name}")

    return True, published_apks, variants_summary, patches_list_path


def validate_env(require_keystore: bool = True) -> None:
    if require_keystore:
        if not os.environ.get("KEYSTORE_BASE64"):
            console.print("[red]Error:[/red] KEYSTORE_BASE64 environment variable not set")
            sys.exit(1)
        if not os.environ.get("KEYSTORE_PASSWORD"):
            console.print("[red]Error:[/red] KEYSTORE_PASSWORD environment variable not set")
            sys.exit(1)


@click.group()
@click.version_option(version=__version__, prog_name="relevance")
def cli() -> None:
    pass


@cli.command()
def hello() -> None:
    console.print("[green]relevance is working[/green]")


@cli.command("check-updates")
@click.option("--config", "config_path", default="apps.yaml", help="Path to apps.yaml")
@click.option("--force", is_flag=True, help="Treat all apps as needing update")
def check_updates_cmd(config_path: str, force: bool) -> None:
    config = load_config(config_path)
    statuses = [check_app_update_status(app, config, force=force) for app in config.apps]
    click.echo(json.dumps({"apps": statuses}, indent=2))


@cli.command("generate-icon")
@click.option("--country", required=True, help="Country code (AM, RU, DE, ...)")
@click.option("--output", "output_dir", required=True, help="Output directory for custom icon")
def generate_icon_cmd(country: str, output_dir: str) -> None:
    out = generate_morphe_custom_icon_dir(Path(output_dir), country=country)
    console.print(f"[green]✓[/green] Generated Morphe custom icon for {country} at {out}")


@cli.command("test-emulator")
@click.option("--apk", "apk_paths", multiple=True, help="APK file(s) to install and test")
@click.option("--repo-dir", default="fdroid/repo", help="Repo directory containing APKs")
def test_emulator_cmd(apk_paths: tuple[str, ...], repo_dir: str) -> None:
    paths = [Path(p) for p in apk_paths] if apk_paths else sorted(Path(repo_dir).glob("*.apk"))
    if not paths:
        raise click.ClickException("No APK files found to test on emulator")
    report = verify_apks_on_emulator(paths)
    click.echo(json.dumps(report, indent=2))


@cli.command("run")
@click.option("--config", "config_path", default="apps.yaml", help="Path to apps.yaml")
@click.option("--dry-run", is_flag=True, help="Show plan without executing")
@click.option("--force", is_flag=True, help="Ignore idempotency, re-process everything")
@click.option("--app", "app_name", default=None, help="Process only this app")
@click.option("--skip-fdroid", is_flag=True, help="Skip F-Droid index generation")
@click.option("--test-emulator", is_flag=True, help="Verify built APKs on Android Emulator")
def run_cmd(
    config_path: str,
    dry_run: bool,
    force: bool,
    app_name: str | None,
    skip_fdroid: bool,
    test_emulator: bool,
) -> None:
    config = load_config(config_path)

    if not dry_run:
        validate_env(require_keystore=not skip_fdroid)

    apps = config.apps
    if app_name:
        apps = [a for a in apps if a.name == app_name]
        if not apps:
            console.print(f"[red]App not found:[/red] {app_name}")
            sys.exit(1)

    output_dir = Path(config.settings.output_dir)
    keystore_path: Path | None = None
    keystore_password = os.environ.get("KEYSTORE_PASSWORD", "")

    if not dry_run and not skip_fdroid:
        keystore_path = decode_keystore(output_dir)
        generate_fdroid_config(config.settings, keystore_path)

    all_apks: list[Path] = []
    all_variants_summary: list[dict[str, str]] = []
    last_patches_list: Path | None = None
    failed = 0

    for app in apps:
        try:
            ok, apks, summary, patches_list = process_app(
                app=app,
                config=config,
                force=force,
                dry_run=dry_run,
                keystore_path=keystore_path,
                keystore_password=keystore_password,
            )
            if ok:
                all_apks.extend(apks)
                all_variants_summary.extend(summary)
                if patches_list:
                    last_patches_list = patches_list
            else:
                failed += 1
        except Exception as e:
            console.print(f"[red]✗[/red] {app.name}: {e}")
            failed += 1

    if failed > 0:
        sys.exit(1)

    if not dry_run and test_emulator and all_apks:
        console.print("[cyan]⟳[/cyan] Testing APKs on Android Emulator...")
        emu_report = verify_apks_on_emulator(all_apks)
        console.print(
            f"[green]✓[/green] Emulator verified {emu_report['side_by_side_count']} "
            f"coexisting packages: {', '.join(emu_report['coexisting_packages'])}"
        )

    if not dry_run and not skip_fdroid:
        version_retention(output_dir, config.settings.keep_versions)
        add_nojekyll(output_dir)
        run_fdroid_update(config.settings)

        fingerprint = (
            get_repo_fingerprint(keystore_path)
            if keystore_path and keystore_path.exists()
            else "unknown"
        )
        if last_patches_list and last_patches_list.exists():
            generate_patch_browser_from_morphe_json(last_patches_list, output_dir)
        generate_landing_page(
            repo_name=config.settings.repo_name,
            repo_description=config.settings.repo_description,
            repo_url=config.settings.repo_url,
            fingerprint=fingerprint,
            github_url="https://github.com/oxcl/relevance",
            variants_info=all_variants_summary,
            output_dir=output_dir,
        )
        console.print(f"[bold]Repo URL:[/bold] {config.settings.repo_url}")
        console.print(f"[bold]Fingerprint:[/bold] {fingerprint}")


if __name__ == "__main__":
    cli()
