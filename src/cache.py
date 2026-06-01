import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path

from pydantic import BaseModel, Field


class AppState(BaseModel):
    source_hash: str
    config_hash: str
    version: str = ""
    last_updated: str = ""


class State(BaseModel):
    apps: dict[str, AppState] = Field(default_factory=dict)


def compute_source_hash(file_path: Path) -> str:
    h = hashlib.sha256()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def compute_config_hash(app_config: dict) -> str:
    serialized = json.dumps(app_config, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(serialized.encode()).hexdigest()


def load_state(repo_dir: Path) -> State:
    state_path = repo_dir / "state.json"
    if not state_path.exists():
        return State()
    with open(state_path) as f:
        data = json.load(f)
    return State(**data)


def save_state(repo_dir: Path, state: State) -> None:
    repo_dir.mkdir(parents=True, exist_ok=True)
    state_path = repo_dir / "state.json"
    data = state.model_dump(mode="json")
    data_str = json.dumps(data, indent=2, sort_keys=False)
    with open(state_path, "w") as f:
        f.write(data_str + "\n")


def is_up_to_date(
    state: State,
    package_id: str,
    current_source_hash: str,
    current_config_hash: str,
) -> bool:
    app_state = state.apps.get(package_id)
    if app_state is None:
        return False
    return (
        app_state.source_hash == current_source_hash
        and app_state.config_hash == current_config_hash
    )


def update_state(
    state: State,
    package_id: str,
    source_hash: str,
    config_hash: str,
    version: str,
) -> None:
    state.apps[package_id] = AppState(
        source_hash=source_hash,
        config_hash=config_hash,
        version=version,
        last_updated=datetime.now(UTC).isoformat(),
    )
