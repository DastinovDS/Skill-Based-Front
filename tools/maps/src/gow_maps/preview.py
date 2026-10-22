"""Map preview PNG (MAP-04): roads, border points, nodes, names, owners, terrain and VP."""

# matplotlib's inline types leave ``**kwargs`` of most Axes methods unannotated, so strict
# pyright reports every call as partially unknown. The rest of the strict checks stay on.
# pyright: reportUnknownMemberType=false

from pathlib import Path

from matplotlib.backends.backend_agg import FigureCanvasAgg
from matplotlib.figure import Figure
from matplotlib.lines import Line2D

from gow_sim.maps import MapDef, NodeKind, Terrain

_OWNER_COLOUR = {0: "#2f6fdf", 1: "#d9453b", None: "#b5b5b5"}
_OWNER_LABEL = {0: "игрок 0", 1: "игрок 1", None: "нейтральный"}
# Terrain is shown by shape, the owner by colour: the preview does not rely on colour alone.
_TERRAIN_MARKER = {Terrain.PLAINS: "o", Terrain.FOREST: "s", Terrain.MOUNTAINS: "^"}
_KIND_MARK = {
    NodeKind.CAPITAL: "",
    NodeKind.CITY_LARGE: " L",
    NodeKind.CITY_MEDIUM: " M",
    NodeKind.CITY_SMALL: " S",
    NodeKind.PROVINCE: " P",
}
_TERRAIN_LABEL = {Terrain.PLAINS: "равнина", Terrain.FOREST: "лес", Terrain.MOUNTAINS: "горы"}


def preview_path(map_path: str | Path) -> Path:
    """``maps/<id>.json`` -> ``maps/<id>.preview.png``."""
    path = Path(map_path)
    return path.with_name(f"{path.stem}.preview.png")


def render_preview(mapdef: MapDef, out: str | Path) -> None:
    width, height = mapdef.meta.width, mapdef.meta.height
    scale = 10 / max(width, height)
    fig = Figure(figsize=(width * scale + 0.5, height * scale + 1.2), dpi=100)
    FigureCanvasAgg(fig)
    ax = fig.add_subplot()
    ax.set_xlim(-40, width + 40)
    ax.set_ylim(height + 40, -40)  # y grows downwards, as on screen
    ax.set_aspect("equal")
    ax.set_xticks([])
    ax.set_yticks([])
    ax.set_facecolor("#f7f5ef")

    for edge in mapdef.edges:
        a, b = mapdef.nodes[edge.a], mapdef.nodes[edge.b]
        xs, ys = [a.x, b.x], [a.y, b.y]
        # Light underlay: the last level of the road; dark line: level 1, where every road starts.
        ax.plot(
            xs,
            ys,
            color="#d8d2c2",
            linewidth=2.2 * edge.max_level,
            solid_capstyle="round",
            zorder=1,
        )
        ax.plot(xs, ys, color="#5b5446", linewidth=1.2, zorder=2)
        # The border point (DEC-23, item 5): a small hollow dot on the road.
        t = edge.border_permille / 1000
        bx, by = a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t
        ax.scatter([bx], [by], s=14, c="white", edgecolors="#5b5446", linewidths=0.8, zorder=2)

    for node in mapdef.nodes:
        capital = node.capital_of is not None
        ax.scatter(
            [node.x],
            [node.y],
            s=520 if capital else 170,
            marker="*" if capital else _TERRAIN_MARKER[node.terrain],
            c=_OWNER_COLOUR[node.start_owner],
            edgecolors="black",
            linewidths=1.6 if capital else 0.8,
            zorder=3,
        )
        # Node kind (DEC-22): S, M, L city; P province; the capital is the star.
        usual_vp = 0 if node.kind is NodeKind.PROVINCE else 1  # shown only when it differs
        label = f"{node.id}{_KIND_MARK[node.kind]} {node.name}" + (
            f"\nvp{node.vp}" if node.vp != usual_vp else ""
        )
        ax.annotate(
            label, (node.x, node.y), xytext=(7, 7), textcoords="offset points", fontsize=7, zorder=4
        )
        if node.start_units:
            ax.annotate(
                f"{node.start_charged}/{node.start_units}",
                (node.x, node.y),
                xytext=(7, -11),
                textcoords="offset points",
                fontsize=6,
                color="#333333",
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
            markeredgecolor="black",
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
            markerfacecolor="white",
            markeredgecolor="black",
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
            markerfacecolor="white",
            markeredgecolor="black",
            label="столица",
        )
    )
    ax.legend(
        handles=handles,
        loc="upper center",
        bbox_to_anchor=(0.5, -0.01),
        ncol=7,
        fontsize=7,
        frameon=False,
    )
    neutral = sum(1 for n in mapdef.nodes if n.start_owner is None)
    ax.set_title(
        f"{mapdef.meta.name} v{mapdef.meta.version}: {len(mapdef.nodes)} узлов, "
        f"{len(mapdef.edges)} дорог, нейтральных {neutral}.\n"
        "Подпись: id, вид (S/M/L: малый, средний, большой город, P: провинция), название, vp;"
        " заряжено/юнитов. Кружок на дороге: точка границы",
        fontsize=9,
    )
    fig.tight_layout()
    # No "Software" metadata: the PNG does not change with the matplotlib version string.
    fig.savefig(out, metadata={"Software": None})
