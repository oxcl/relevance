from pathlib import Path

from src.config import load_config
from src.icons import MIPMAP_DENSITIES, generate_morphe_custom_icon_dir
from src.morphe import _parse_semver_key


def test_load_apps_yaml() -> None:
    cfg = load_config("apps.yaml")
    assert cfg.settings.repo_name == "Relevance"
    assert len(cfg.apps) >= 1
    yt = cfg.apps[0]
    assert yt.package_id == "com.google.android.youtube"
    variants = yt.effective_variants()
    assert [v.name for v in variants] == [
        "YouTube",
        "YouTube AM",
        "YouTube RU",
        "YouTube DE",
    ]
    assert [v.package_name for v in variants] == [
        "app.morphe.android.youtube",
        "app.morphe.android.youtube.am",
        "app.morphe.android.youtube.ru",
        "app.morphe.android.youtube.de",
    ]


def test_generate_morphe_custom_icons(tmp_path: Path) -> None:
    for country in ("AM", "RU", "DE"):
        out_dir = tmp_path / f"icon_{country}"
        generate_morphe_custom_icon_dir(out_dir, country=country)
        assert (out_dir / "icon_512.png").exists()
        for folder in MIPMAP_DENSITIES:
            assert (out_dir / folder / "morphe_adaptive_background_custom.png").exists()
            assert (out_dir / folder / "morphe_adaptive_foreground_custom.png").exists()


def test_semver_sorting() -> None:
    assert _parse_semver_key("20.51.39") > _parse_semver_key("20.21.37")
    assert _parse_semver_key("21.20.405") > _parse_semver_key("20.51.39")
