"""Map preview PNG (MAP-04): roads, border points, nodes, names, owners, terrain and VP.

In the Engraved look of the match (#839, after #829): the dark plate, the map's own baked ground
(``<id>.bg.webp``, when it is there) darkened under the graph, ink roads and labels on a dark
casing, the own and enemy colours of the match. The PNG is reduced to a palette so it stays small.
"""

# matplotlib's inline types leave ``**kwargs`` of most Axes methods unannotated, so strict
# pyright reports every call as partially unknown. The rest of the strict checks stay on.
# pyright: reportUnknownMemberType=false

import io
from pathlib import Path

import numpy as np
from matplotlib import patheffects
from matplotlib.backends.backend_agg import FigureCanvasAgg
from matplotlib.figure import Figure
from matplotlib.lines import Line2D
from numpy.typing import NDArray
from PIL import Image

from gow_sim.maps import MapDef, NodeKind, Terrain

# The Engraved tokens (apps/client/src/theme/tokens.ts, ENGRAVED).
_PLATE = "#0e0c09"
_CASING = "#060504"
_INK = "#ece4d1"
_INK_DIM = "#ada38f"
_VP = "#cfab62"
_OWNER_COLOUR = {0: "#86a6ea", 1: "#e5785e", None: "#b3a88f"}
_OWNER_LABEL = {0: "player 0", 1: "player 1", None: "neutral"}
# Terrain is shown by shape, the owner by colour: the preview does not rely on colour alone.
_TERRAIN_MARKER = {Terrain.PLAINS: "o", Terrain.FOREST: "s", Terrain.MOUNTAINS: "^"}
_KIND_MARK = {
    NodeKind.CAPITAL: "",
    NodeKind.CITY_LARGE: " L",
    NodeKind.CITY_MEDIUM: " M",
    NodeKind.CITY_SMALL: " S",
    NodeKind.PROVINCE: " P",
}
_TERRAIN_LABEL = {
    Terrain.PLAINS: "plains",
    Terrain.FOREST: "forest",
    Terrain.MOUNTAINS: "mountains",
}
# How light the baked ground stays under the graph, and the colours of the palette PNG.
_GROUND_LIGHT = 0.5
_PALETTE_COLOURS = 96
_HALO: list[patheffects.AbstractPathEffect] = [
    patheffects.withStroke(linewidth=2.6, foreground=_CASING)
]
_CASED: list[patheffects.AbstractPathEffect] = [
    patheffects.Stroke(linewidth=3.2, foreground=_CASING),
    patheffects.Normal(),
]


def preview_path(map_path: str | Path) -> Path:
    """``maps/<id>.json`` -> ``maps/<id>.preview.png``."""
    path = Path(map_path)
    return path.with_name(f"{path.stem}.preview.png")


def _ground(background: Path | None) -> NDArray[np.float32] | None:
    """The baked ground, darkened, as RGB floats; ``None`` without a background file."""
    if background is None or not background.is_file():
        return None
    with Image.open(background) as image:
        pixels = np.asarray(image.convert("RGB"), dtype=np.float32) / 255.0
    return pixels * _GROUND_LIGHT


def render_preview(mapdef: MapDef, out: str | Path, background: str | Path | None = None) -> None:
    """Draw the preview of ``mapdef`` into ``out`` (PNG), over ``background`` when given."""
    width, height = mapdef.meta.width, mapdef.meta.height
    scale = 10 / max(width, height)
    fig = Figure(figsize=(width * scale + 0.5, height * scale + 1.2), dpi=100, facecolor=_PLATE)
    FigureCanvasAgg(fig)
    ax = fig.add_subplot()
    ax.set_xlim(-40, width + 40)
    ax.set_ylim(height + 40, -40)  # y grows downwards, as on screen
    ax.set_aspect("equal")
    ax.set_xticks([])
    ax.set_yticks([])
    ax.set_facecolor(_PLATE)
    for spine in ax.spines.values():
        spine.set_color(_INK_DIM)
        spine.set_linewidth(0.6)

    ground = _ground(None if background is None else Path(background))
    if ground is not None:
        ax.imshow(ground, extent=(0, width, height, 0), interpolation="bilinear", zorder=0)

    for edge in mapdef.edges:
        a, b = mapdef.nodes[edge.a], mapdef.nodes[edge.b]
        xs, ys = [a.x, b.x], [a.y, b.y]
        # Faint underlay: the last level of the road; the ink line on its casing: level 1, where
        # every road starts.
        ax.plot(
            xs,
            ys,
            color=_INK,
            alpha=0.16,
            linewidth=2.2 * edge.max_level,
            solid_capstyle="round",
            zorder=1,
        )
        line = ax.plot(xs, ys, color=_INK, alpha=0.8, linewidth=1.1, zorder=2)[0]
        line.set_path_effects(_CASED)
        # The border point (DEC-23, item 5): a small hollow dot on the road.
        t = edge.border_permille / 1000
        bx, by = a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t
        ax.scatter([bx], [by], s=14, c=_CASING, edgecolors=_INK, linewidths=0.8, zorder=2)

    for node in mapdef.nodes:
        capital = node.capital_of is not None
        ax.scatter(
            [node.x],
            [node.y],
            s=520 if capital else 170,
            marker="*" if capital else _TERRAIN_MARKER[node.terrain],
            c=_OWNER_COLOUR[node.start_owner],
            edgecolors=_CASING,
            linewidths=1.8 if capital else 1.2,
            zorder=3,
        )
        # Node kind (DEC-22): S, M, L city; P province; the capital is the star.
        usual_vp = 0 if node.kind is NodeKind.PROVINCE else 1  # shown only when it differs
        label = f"{node.id}{_KIND_MARK[node.kind]} {node.name}" + (
            f"\nvp{node.vp}" if node.vp != usual_vp else ""
        )
        ax.annotate(
            label,
            (node.x, node.y),
            xytext=(7, 7),
            textcoords="offset points",
            fontsize=7,
            color=_INK,
            path_effects=_HALO,
            zorder=4,
        )
        if node.start_units:
            ax.annotate(
                f"{node.start_charged}/{node.start_units}",
                (node.x, node.y),
                xytext=(7, -11),
                textcoords="offset points",
                fontsize=6,
                color=_VP,
                path_effects=_HALO,
                zorder=4,
            )

    handles = [
        Line2D(
            [],
            [],
            marker="o",
            linestyle="",
            markersize=8,
            markerfacecolor=colour,
            markeredgecolor=_CASING,
            label=_OWNER_LABEL[owner],
        )
        for owner, colour in _OWNER_COLOUR.items()
    ]
    handles += [
        Line2D(
            [],
            [],
            marker=marker,
            linestyle="",
            markersize=8,
            markerfacecolor=_PLATE,
            markeredgecolor=_INK,
            label=_TERRAIN_LABEL[terrain],
        )
        for terrain, marker in _TERRAIN_MARKER.items()
    ]
    handles.append(
        Line2D(
            [],
            [],
            marker="*",
            linestyle="",
            markersize=12,
            markerfacecolor=_PLATE,
            markeredgecolor=_INK,
            label="capital",
        )
    )
    ax.legend(
        handles=handles,
        loc="upper center",
        bbox_to_anchor=(0.5, -0.01),
        ncol=7,
        fontsize=7,
        frameon=False,
        labelcolor=_INK,
    )
    neutral = sum(1 for n in mapdef.nodes if n.start_owner is None)
    ax.set_title(
        f"{mapdef.meta.name} v{mapdef.meta.version}: {len(mapdef.nodes)} nodes, "
        f"{len(mapdef.edges)} roads, neutral {neutral}.\n"
        "Label: id, kind (S/M/L: small, medium, large city, P: province), name, vp;"
        " charged/units. Circle on a road: border point",
        fontsize=9,
        color=_INK,
    )
    fig.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="png", facecolor=_PLATE)
    buf.seek(0)
    # A palette PNG: the textured ground would make a true-colour file several times larger.
    # No metadata: the file does not change with the matplotlib or Pillow version string.
    with Image.open(buf) as image:
        _palette_png(image.convert("RGB")).save(out, format="PNG", optimize=True)


def _rgb(colour: str) -> list[int]:
    return [int(colour[i : i + 2], 16) for i in (1, 3, 5)]


def _palette_png(rgb: Image.Image) -> Image.Image:
    """``rgb`` on a palette of the picture's own colours plus the exact colours of the pieces.

    A plain quantization gives the few pixels of the owner colours away to the ground; they are
    kept here as they are, so the owners read on the preview.
    """
    keys = [*_OWNER_COLOUR.values(), _PLATE, _CASING, _INK, _INK_DIM, _VP]
    found = rgb.quantize(colors=_PALETTE_COLOURS, dither=Image.Dither.NONE).getpalette() or []
    palette = [v for key in keys for v in _rgb(key)] + found[: _PALETTE_COLOURS * 3]
    holder = Image.new("P", (1, 1))
    holder.putpalette(palette + [0] * (768 - len(palette)))
    return rgb.quantize(palette=holder, dither=Image.Dither.NONE)
