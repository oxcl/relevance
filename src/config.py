import os
from pathlib import Path

import yaml
from pydantic import BaseModel, Field


class Settings(BaseModel):
    repo_name: str = "Relevance"
    repo_description: str = ""
    output_dir: str = "fdroid/repo"
    publish_original: bool = True
    keep_versions: int = 2


class SourceConfig(BaseModel):
    type: str | list[str] = "direct"
    url: str | None = None
    repo: str | None = None
    tag: str = "latest"
    asset_pattern: str = "*.apk"
    version: str = "auto"
    extra: dict[str, str] = Field(default_factory=dict)


class PatchConfig(BaseModel):
    include: list[str] = []
    exclude: list[str] = []


class Operation(BaseModel):
    type: str
    framework: str | None = None
    patch_source: str | None = None
    patches: PatchConfig = Field(default_factory=PatchConfig)
    force: bool = False
    new_package: str | None = None
    new_name: str | None = None
    icon: dict | None = None
    description_append: str = ""


class AppConfig(BaseModel):
    name: str
    package_id: str
    description: str | None = None
    source: SourceConfig = Field(default_factory=SourceConfig)
    operations: list[Operation] = Field(default_factory=list)


class PatchSourceEntry(BaseModel):
    name: str
    type: str = "github_release"
    repo: str | None = None
    url: str | None = None
    asset_pattern: str = "*.rvp"


class PatchSources(BaseModel):
    revanced: list[PatchSourceEntry] = Field(default_factory=list)


class AppConfigFile(BaseModel):
    settings: Settings = Field(default_factory=Settings)
    patch_sources: PatchSources = Field(default_factory=PatchSources)
    apps: list[AppConfig] = Field(default_factory=list)


def _resolve_env_vars(value: str) -> str:
    if value.startswith("${") and value.endswith("}"):
        env_name = value[2:-1]
        env_val = os.environ.get(env_name)
        if env_val is None:
            raise ValueError(f"Environment variable {env_name} is not set")
        return env_val
    return value


def _resolve_env_in_config(data: dict) -> dict:
    resolved = {}
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
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"Config file not found: {path}")

    with open(path) as f:
        data = yaml.safe_load(f)

    data = _resolve_env_in_config(data)
    return AppConfigFile(**data)
