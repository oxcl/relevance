import logging
import os
import shutil
import sys
from pathlib import Path

import click
from rich.console import Console

from src import __version__
from src.cache import (
    compute_config_hash,
    compute_source_hash,
    is_up_to_date,
    load_state,
    save_state,
    update_state,
)
from src.config import AppConfigFile, Operation, load_config
from src.fdroid import (
    add_nojekyll,
    decode_keystore,
    generate_fdroid_config,
    get_repo_fingerprint,
    run_fdroid_update,
    version_retention,
)
from src.merge.merger import is_split_apk, merge_split_apk, sign_apk
from src.operations.clone.clone import CloneOperation
from src.operations.patch.revanced import (
    RevancedPatchOperation,
    download_patches,
    get_recommended_version,
)
from src.sources.auto import download_apk
from src.web import generate_landing_page, generate_patch_browser

console = Console()
log = logging.getLogger(__name__)


def _resolve_version_for_revanved(
    app_config: dict,
    source: dict,
    patches_paths: list,
    name: str,
) -> str | None:
    version = source.get("version", "auto")
    if version != "auto":
        return version

    package_id = app_config["package_id"]
    recommended = get_recommended_version(patches_paths, package_id)
    if recommended:
        console.print(f"[cyan]ℹ[/cyan] {name}: recommended version {recommended}")
    return recommended


def process_app(
    app_config: dict,
    config: AppConfigFile,
    force: bool,
    dry_run: bool,
    patches_paths: list,
) -> bool:
    name = app_config["name"]
    package_id = app_config["package_id"]
    source = app_config.get("source", {})
    source_type = source.get("type", "direct")
    operations = app_config.get("operations", [])

    if isinstance(source_type, list):
        source_type = source_type[0]

    output_dir = Path(config.settings.output_dir)
    cache_dir = Path(".cache") / package_id
    state = load_state(output_dir)

    config_hash = compute_config_hash(app_config)

    has_revanved = any(op.get("framework") == "revanced" for op in operations)

    if dry_run:
        ops_str = ", ".join(op.get("type", "?") for op in operations) or "none"
        console.print(f"[cyan]DRY RUN[/cyan] {name}: {source_type} → {output_dir} [{ops_str}]")
        return True

    cache_dir.mkdir(parents=True, exist_ok=True)

    target_package = package_id
    for op in operations:
        if op.get("type") == "clone" and op.get("new_package"):
            target_package = op["new_package"]
            break

    existing_apks = list(output_dir.glob(f"{target_package}_*.apk"))
    if not existing_apks:
        existing_apks = list(output_dir.glob(f"{target_package}.apk"))
    if existing_apks and not force:
        existing_apk = existing_apks[0]
        source_hash = compute_source_hash(existing_apk)
        if is_up_to_date(state, target_package, source_hash, config_hash):
            console.print(f"[green]✓[/green] {name}: up to date, skipping")
            return True

    if has_revanved and source_type == "apkpure":
        recommended = _resolve_version_for_revanved(app_config, source, patches_paths, name)
        if recommended:
            source["version"] = recommended

    source_path = _download_source(source_type, package_id, source, cache_dir, name)
    if source_path is None:
        return False

    if is_split_apk(source_path):
        console.print(f"[yellow]⟳[/yellow] {name}: split APK detected, merging...")
        try:
            source_path = merge_split_apk(source_path, cache_dir)
            source_path = sign_apk(source_path)
        except Exception as e:
            console.print(f"[red]✗[/red] {name}: merge failed — {e}")
            return False

    current_apk = source_path

    for op in operations:
        op_type = op.get("type")
        op_config = Operation(**op)

        if op_type == "patch":
            framework = op.get("framework", "revanced")
            if framework == "revanced":
                console.print(f"[blue]⟳[/blue] {name}: applying ReVanced patches...")
                try:
                    patch_op = RevancedPatchOperation(patches_paths)
                    work_dir = cache_dir / "patch_work"
                    current_apk = patch_op.apply(current_apk, op_config, work_dir)
                    console.print(f"[green]✓[/green] {name}: patches applied")
                except Exception as e:
                    console.print(f"[red]✗[/red] {name}: patch failed — {e}")
                    return False
            else:
                console.print(
                    f"[yellow]⚠[/yellow] {name}: framework '{framework}' not implemented yet"
                )
        elif op_type == "clone":
            console.print(f"[blue]⟳[/blue] {name}: cloning...")
            try:
                clone_op = CloneOperation()
                work_dir = cache_dir / "clone_work"
                current_apk = clone_op.apply(current_apk, op_config, work_dir)
                console.print(f"[green]✓[/green] {name}: cloned → {op_config.new_package}")
            except Exception as e:
                console.print(f"[red]✗[/red] {name}: clone failed — {e}")
                return False
        else:
            console.print(f"[yellow]⚠[/yellow] {name}: unknown operation '{op_type}', skipping")

    output_dir.mkdir(parents=True, exist_ok=True)

    if operations:
        dest_name = f"{target_package}_1.apk"
    else:
        dest_name = current_apk.name

    dest_path = output_dir / dest_name
    shutil.copy2(current_apk, dest_path)

    source_hash = compute_source_hash(dest_path)
    update_state(state, target_package, source_hash, config_hash, "latest")
    save_state(output_dir, state)

    console.print(f"[green]✓[/green] {name}: published → {dest_path.name}")
    return True


def _download_source(
    source_type: str,
    package_id: str,
    source: dict,
    cache_dir: Path,
    name: str,
) -> Path | None:
    if source_type == "direct":
        url = source.get("url")
        if not url:
            console.print(f"[red]✗[/red] {name}: direct source requires 'url'")
            return None
        try:
            return download_apk(
                source_type="direct",
                package_id=package_id,
                version="latest",
                dest=cache_dir,
                config={"url": url},
            )
        except Exception as e:
            console.print(f"[red]✗[/red] {name}: download failed — {e}")
            return None
    elif source_type == "apkpure":
        version = source.get("version", "latest")
        try:
            return download_apk(
                source_type="apkpure",
                package_id=package_id,
                version=version,
                dest=cache_dir,
            )
        except Exception as e:
            console.print(f"[red]✗[/red] {name}: APKPure download failed — {e}")
            return None
    else:
        console.print(f"[red]✗[/red] {name}: source type '{source_type}' not implemented yet")
        return None


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


@cli.command("run")
@click.option("--config", "config_path", required=True, help="Path to apps.yml")
@click.option("--dry-run", is_flag=True, help="Show plan without executing")
@click.option("--force", is_flag=True, help="Ignore idempotency, re-process everything")
@click.option("--app", "app_name", default=None, help="Process only this app")
@click.option("--skip-fdroid", is_flag=True, help="Skip F-Droid index generation")
def run(
    config_path: str,
    dry_run: bool,
    force: bool,
    app_name: str | None,
    skip_fdroid: bool,
) -> None:
    try:
        config = load_config(config_path)
    except Exception as e:
        console.print(f"[red]Config error:[/red] {e}")
        sys.exit(1)

    if not dry_run:
        validate_env(require_keystore=not skip_fdroid)

    has_revanved = False
    for app in config.apps:
        for op in app.operations:
            if op.framework == "revanced":
                has_revanved = True
                break

    patches_paths = []
    if has_revanved and config.patch_sources.revanced:
        console.print("[cyan]⟳[/cyan] Downloading ReVanced patches...")
        try:
            patches_paths = download_patches(config.patch_sources.revanced)
            console.print(f"[green]✓[/green] Downloaded {len(patches_paths)} patch bundle(s)")
        except Exception as e:
            console.print(f"[red]✗[/red] Failed to download patches: {e}")

    apps = config.apps
    if app_name:
        apps = [a for a in apps if a.name == app_name]
        if not apps:
            console.print(f"[red]App not found:[/red] {app_name}")
            sys.exit(1)

    console.print(f"[bold]Relevance[/bold] v{__version__}")
    console.print(f"Repo: {config.settings.repo_name}")
    console.print(f"Apps: {len(apps)}")
    if dry_run:
        console.print("[cyan]DRY RUN — no changes will be made[/cyan]")
    console.print()

    output_dir = Path(config.settings.output_dir)

    if not dry_run and not skip_fdroid:
        keystore_path = decode_keystore(output_dir)
        generate_fdroid_config(config.settings, keystore_path)
        console.print("[green]✓[/green] Keystore decoded, F-Droid config generated")
        console.print()

    success = 0
    failed = 0

    for app in apps:
        app_dict = app.model_dump(mode="json")
        try:
            if process_app(app_dict, config, force, dry_run, patches_paths):
                success += 1
            else:
                failed += 1
        except Exception as e:
            console.print(f"[red]✗[/red] {app.name}: {e}")
            failed += 1

    console.print()

    if not dry_run and not skip_fdroid:
        removed = version_retention(output_dir, config.settings.keep_versions)
        if removed > 0:
            console.print(f"[yellow]♻[/yellow] Removed {removed} old APK versions")

        add_nojekyll(output_dir)
        run_fdroid_update(config.settings)

        console.print("[cyan]⟳[/cyan] Generating web UI...")
        if patches_paths:
            generate_patch_browser(patches_paths, output_dir)
        generate_landing_page(
            repo_name=config.settings.repo_name,
            repo_description=config.settings.repo_description,
            repo_url="https://oxcl.github.io/relevance/fdroid.repo",
            github_url="https://github.com/oxcl/relevance",
            output_dir=output_dir,
        )
        console.print("[green]✓[/green] Web UI generated")

        keystore_path = output_dir.parent / "keystore.p12"
        if keystore_path.exists():
            fingerprint = get_repo_fingerprint(keystore_path)
        else:
            fingerprint = "unknown"

        console.print()
        console.print("[bold]Repo URL:[/bold] https://oxcl.github.io/relevance/fdroid.repo")
        console.print(f"[bold]Fingerprint:[/bold] {fingerprint}")
        console.print(
            f"[bold]Add:[/bold] https://oxcl.github.io/relevance/fdroid.repo?fingerprint={fingerprint}"
        )

    console.print()
    console.print(f"[green]{success} succeeded[/green], [red]{failed} failed[/red]")
    if failed > 0:
        sys.exit(1)


if __name__ == "__main__":
    cli()
