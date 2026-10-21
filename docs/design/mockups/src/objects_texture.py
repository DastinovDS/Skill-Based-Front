"""Background of the mockup objects-style.html (issue #337): the T2 texture the owner chose in #335.

NOT project code and NOT a replacement of ``gow_maps.bake``: a throwaway generator in the spirit
of ``map_textures.py`` (#335), whose functions it reuses. It draws only the variant T2 (thinning),
crops the fragment of ``arteriya`` that the mockup shows and embeds the picture as base64 between
the markers ``/*TEX:BEGIN*/`` and ``/*TEX:END*/`` of ``docs/design/mockups/objects-style.html``.
Deterministic for a pinned numpy.

Run from the repository root (about 20 s)::

    uv run python docs/design/mockups/src/objects_texture.py
"""

import json
import re
import sys

from map_textures import ROOT, biome_labels, compose, data_uri, variant_t2
from PIL import Image

HTML = ROOT / "docs" / "design" / "mockups" / "objects-style.html"
CROP = (70, 130, 840, 580)  # x, y, width, height of the fragment in the mockup (world units)


def main() -> int:
    lab = biome_labels(ROOT / "maps" / "arteriya.json")
    mask, density = variant_t2(lab)
    pic = Image.fromarray(compose(mask, density, 2.4, 40, True, 255), "RGB")
    x0, y0, cw, ch = CROP
    data = {
        "map": "arteriya",
        "crop": list(CROP),
        "t2": data_uri(pic.crop((x0, y0, x0 + cw, y0 + ch)), "jpeg"),
    }
    text = HTML.read_text(encoding="utf-8")
    block = "/*TEX:BEGIN*/window.TEX=" + json.dumps(data) + ";/*TEX:END*/"
    new, n = re.subn(r"/\*TEX:BEGIN\*/.*?/\*TEX:END\*/", lambda _m: block, text, flags=re.S)
    if n != 1:
        print(f"markers /*TEX:BEGIN*/ and /*TEX:END*/ not found in {HTML}", file=sys.stderr)
        return 1
    HTML.write_text(new, encoding="utf-8")
    print(f"embedded into {HTML.relative_to(ROOT)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
