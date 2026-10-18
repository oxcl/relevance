import os
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field


class Settings(BaseModel):
    repo_name: str = "Relevance"
    repo_description: str = "Automated Morphe-patched Android apps F-Droid repository"
    repo_url: str = "https://oxcl.github.io/relevance"
    output_dir: str = "fdroid/repo"
    publish_original: bool = False
    keep_versions: int = 2
    default_source: str = "apk-pure"
    default_patch_source: str = "MorpheApp/morphe-patches"


class IconConfig(BaseModel):
    type: str = "original"
    country: str | None = None
    stripes: list[str] | None = None
    custom_path: str | None = None


class PatchOptionOverride(BaseModel):
    enable: list[str] = Field(default_factory=list)
    disable: list[str] = Field(default_factory=list)
    options: dict[str, dict[str, Any]] = Field(default_factory=dict)


class VariantConfig(BaseModel):
    id: str
    name: str
    package_name: str
    icon: IconConfig = Field(default_factory=IconConfig)
    patches: PatchOptionOverride = Field(default_factory=PatchOptionOverride)


class AppConfig(BaseModel):
    name: str
    package_id: str
    description: str | None = None
    source: str = "apk-pure"
    version: str = "auto"
    patch_source: str = "MorpheApp/morphe-patches"
    patches: str | PatchOptionOverride = "default"
    include_experimental: bool = False
    agent_instructions: str = ""
    variants: list[VariantConfig] = Field(default_factory=list)

    def effective_variants(self) -> list[VariantConfig]:
        if self.variants:
            return self.variants
        default_pkg = (
            "app.morphe.android.youtube"
            if self.package_id == "com.google.android.youtube"
            else f"{self.package_id}.morphe"
        )
        return [
            VariantConfig(
                id=self.name.lower().replace(" ", "-"),
                name=self.name,
                package_name=default_pkg,
                icon=IconConfig(type="original"),
            )
        ]


class AppConfigFile(BaseModel):
    settings: Settings = Field(default_factory=Settings)
    apps: list[AppConfig] = Field(default_factory=list)


def _resolve_env_vars(value: str) -> str:
    if value.startswith("${") and value.endswith("}"):
        env_name = value[2:-1]
        env_val = os.environ.get(env_name)
        if env_val is None:
            raise ValueError(f"Environment variable {env_name} is not set")
        return env_val
    return value


def _resolve_env_in_config(data: dict[str, Any]) -> dict[str, Any]:
    resolved: dict[str, Any] = {}
    for k, v in data.items():
        if isinstance(v, str):
            resolved[k] = _resolve_env_vars(v)
        elif isinstance(v, dict):
            resolved[k] = _resolve_env_in_config(v)
        elif isinstance(v, list):
            resolved[k] = [_resolve_env_in_config(i) if isinstance(i, dict) else i for i in v]
        else:
            resolved[k] = v
    return resolved


def load_config(path: str | Path) -> AppConfigFile:
    p = Path(path)
    if not p.exists():
        alt = Path("apps.yaml") if p.name == "apps.yml" else Path("apps.yml")
        if alt.exists():
            p = alt
        else:
            raise FileNotFoundError(f"Config file not found: {path}")

    with open(p) as f:
        data = yaml.safe_load(f) or {}

    data = _resolve_env_in_config(data)
    return AppConfigFile(**data)
