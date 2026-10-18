from pathlib import Path

from PIL import Image, ImageDraw

MIPMAP_DENSITIES: dict[str, int] = {
    "mipmap-mdpi": 108,
    "mipmap-hdpi": 162,
    "mipmap-xhdpi": 216,
    "mipmap-xxhdpi": 324,
    "mipmap-xxxhdpi": 432,
}

COUNTRY_FLAGS: dict[str, tuple[str, list[str]]] = {
    "AM": ("horizontal", ["#D90012", "#0033A0", "#F2A800"]),
    "ARMENIA": ("horizontal", ["#D90012", "#0033A0", "#F2A800"]),
    "RU": ("horizontal", ["#FFFFFF", "#0039A6", "#D52B1E"]),
    "RUSSIA": ("horizontal", ["#FFFFFF", "#0039A6", "#D52B1E"]),
    "DE": ("horizontal", ["#000000", "#DD0000", "#FFCE00"]),
    "GERMANY": ("horizontal", ["#000000", "#DD0000", "#FFCE00"]),
    "UA": ("horizontal", ["#005BBB", "#FFD500"]),
    "NL": ("horizontal", ["#AE1C28", "#FFFFFF", "#21468B"]),
    "AT": ("horizontal", ["#ED2939", "#FFFFFF", "#ED2939"]),
    "PL": ("horizontal", ["#FFFFFF", "#DC143C"]),
    "FR": ("vertical", ["#002395", "#FFFFFF", "#ED2939"]),
    "IT": ("vertical", ["#009246", "#FFFFFF", "#CE2B37"]),
    "BE": ("vertical", ["#000000", "#FAE042", "#ED2939"]),
    "IE": ("vertical", ["#169B62", "#FFFFFF", "#FF883E"]),
}


def _hex_to_rgba(color: str, alpha: int = 255) -> tuple[int, int, int, int]:
    c = color.lstrip("#")
    if len(c) == 3:
        c = "".join(ch * 2 for ch in c)
    return (int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16), alpha)


def resolve_flag_spec(
    country: str | None = None,
    stripes: list[str] | None = None,
) -> tuple[str, list[str]]:
    if stripes:
        return ("horizontal", stripes)
    if country:
        key = country.strip().upper()
        if key in COUNTRY_FLAGS:
            return COUNTRY_FLAGS[key]
    raise ValueError(
        f"Unsupported country '{country}'. Provide a known country code ({list(COUNTRY_FLAGS)}) "
        "or explicit 'stripes' hex colors."
    )


def _draw_flag_fill(
    width: int,
    height: int,
    orientation: str,
    colors: list[str],
) -> Image.Image:
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    n = len(colors)
    if n == 0:
        return img

    if orientation == "vertical":
        for idx, hex_color in enumerate(colors):
            x0 = int(round(idx * width / n))
            x1 = int(round((idx + 1) * width / n))
            draw.rectangle([x0, 0, x1, height], fill=_hex_to_rgba(hex_color))
    else:
        for idx, hex_color in enumerate(colors):
            y0 = int(round(idx * height / n))
            y1 = int(round((idx + 1) * height / n))
            draw.rectangle([0, y0, width, y1], fill=_hex_to_rgba(hex_color))

    return img


def render_youtube_logo_layer(
    size: int,
    orientation: str,
    colors: list[str],
    with_outer_background: bool = False,
    outer_bg_color: str = "#FFFFFF",
) -> Image.Image:
    scale = 4
    s = size * scale
    canvas = Image.new(
        "RGBA",
        (s, s),
        _hex_to_rgba(outer_bg_color, 255) if with_outer_background else (0, 0, 0, 0),
    )

    if with_outer_background:
        rect_w = int(round(s * 0.76))
        rect_h = int(round(rect_w * 0.70))
    else:
        rect_w = int(round(s * 0.58))
        rect_h = int(round(rect_w * 0.70))

    x0 = (s - rect_w) // 2
    y0 = (s - rect_h) // 2
    x1 = x0 + rect_w
    y1 = y0 + rect_h
    corner_radius = int(round(rect_h * 0.24))

    mask = Image.new("L", (rect_w, rect_h), 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.rounded_rectangle([0, 0, rect_w - 1, rect_h - 1], radius=corner_radius, fill=255)

    flag_img = _draw_flag_fill(rect_w, rect_h, orientation, colors)

    border_width = max(2, int(round(s * 0.008)))
    shadow_offset = max(2, int(round(s * 0.01)))
    shadow_layer = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow_layer)
    shadow_draw.rounded_rectangle(
        [x0, y0 + shadow_offset, x1, y1 + shadow_offset],
        radius=corner_radius,
        fill=(0, 0, 0, 65),
    )
    canvas = Image.alpha_composite(canvas, shadow_layer)

    badge_layer = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    badge_layer.paste(flag_img, (x0, y0), mask)

    badge_draw = ImageDraw.Draw(badge_layer)
    badge_draw.rounded_rectangle(
        [x0, y0, x1 - 1, y1 - 1],
        radius=corner_radius,
        outline=(18, 22, 28, 220),
        width=border_width,
    )

    cx = s / 2.0
    cy = s / 2.0
    tri_h = rect_h * 0.42
    tri_w = tri_h * 0.88
    offset_x = rect_w * 0.025
    p1 = (cx - tri_w / 2.0 + offset_x, cy - tri_h / 2.0)
    p2 = (cx - tri_w / 2.0 + offset_x, cy + tri_h / 2.0)
    p3 = (cx + tri_w / 2.0 + offset_x, cy)

    outline_pad = max(2.0, s * 0.009)
    p1_out = (p1[0] - outline_pad * 0.6, p1[1] - outline_pad)
    p2_out = (p2[0] - outline_pad * 0.6, p2[1] + outline_pad)
    p3_out = (p3[0] + outline_pad, p3[1])
    badge_draw.polygon([p1_out, p2_out, p3_out], fill=(15, 18, 24, 165))
    badge_draw.polygon([p1, p2, p3], fill=(255, 255, 255, 255))

    canvas = Image.alpha_composite(canvas, badge_layer)
    return canvas.resize((size, size), Image.Resampling.LANCZOS)


def generate_morphe_custom_icon_dir(
    output_dir: Path,
    country: str | None = None,
    stripes: list[str] | None = None,
) -> Path:
    orientation, colors = resolve_flag_spec(country=country, stripes=stripes)
    output_dir.mkdir(parents=True, exist_ok=True)

    for folder_name, px in MIPMAP_DENSITIES.items():
        dpi_dir = output_dir / folder_name
        dpi_dir.mkdir(parents=True, exist_ok=True)

        bg_img = Image.new("RGBA", (px, px), (255, 255, 255, 255))
        bg_img.save(dpi_dir / "morphe_adaptive_background_custom.png", format="PNG")

        fg_img = render_youtube_logo_layer(
            size=px,
            orientation=orientation,
            colors=colors,
            with_outer_background=False,
        )
        fg_img.save(dpi_dir / "morphe_adaptive_foreground_custom.png", format="PNG")

    preview_512 = render_youtube_logo_layer(
        size=512,
        orientation=orientation,
        colors=colors,
        with_outer_background=True,
        outer_bg_color="#FFFFFF",
    )
    preview_512.save(output_dir / "icon_512.png", format="PNG")
    return output_dir


def generate_original_youtube_icon(output_path: Path, size: int = 512) -> Path:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    img = render_youtube_logo_layer(
        size=size,
        orientation="horizontal",
        colors=["#FF0033"],
        with_outer_background=True,
        outer_bg_color="#FFFFFF",
    )
    img.save(output_path, format="PNG")
    return output_path
