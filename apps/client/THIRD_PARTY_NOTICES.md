# Third-party notices

Everything below is shipped inside the client build (`apps/client`). An asset without an entry here
is a review error (docs/design/ui-style.md, section 8). The same notices are on the legal page of
the game (section "Licences").

## Lucide icons

The icons of the match HUD (`src/hud/icons.ts`, drawn by `src/hud/Icon.svelte`) are copied from
[Lucide](https://lucide.dev) as plain SVG path data, without the npm package. Only their colour
(`currentColor`) is changed.

Lucide is licensed under the ISC licence; the shapes that Lucide took over from Feather are under
the MIT licence. Both notices must be kept.

### ISC licence (Lucide)

ISC License

Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT).
All other copyright (c) for Lucide are held by Lucide Contributors 2022.

Permission to use, copy, modify, and/or distribute this software for any purpose with or without
fee is hereby granted, provided that the above copyright notice and this permission notice appear
in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS
SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE
AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT,
NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
THIS SOFTWARE.

### MIT licence (Feather)

The MIT License (MIT)

Copyright (c) 2013-2022 Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT
OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Bundled npm libraries

PixiJS, Svelte and their runtime dependencies (MIT, ISC, BSD-3-Clause) are bundled by Vite, which
strips their licence banners. `vite build` therefore writes the licence text of every bundled
dependency to `dist/third-party-licenses.txt` (`build.license` in `vite.config.ts`, generated from
the installed packages, nothing to maintain by hand). The legal page links to it, and
`deploy/check-caddy.sh` checks that it is served.

Known gap: `@pixi/colord` (MIT, author Vlad Shilov, a PixiJS dependency) ships no licence file in its
npm package, so its entry in the generated file has a heading but no text.

## City menu icons (SpriteCook)

The three city menu icons in `src/hud/menuIcons/` (recruit, barracks, warehouse; set R5 "Chevrons",
issue #627) were generated on 2026-10-30 with [SpriteCook](https://spritecook.ai) (model gpt-image-2,
asset `d26e22f1-d6f4-4d72-8608-c7e76f9228bd` of the project "Skill-Based Front"), then cut, keyed to
transparency and scaled to 96 px for this project. The SpriteCook terms checked on that date
(section 6) let the user "use, reproduce, and distribute outputs you generate", on every plan; the
outputs carry no warranty and are not guaranteed to be unique.

## Sounds and fonts

None yet (package F adds the sounds under CC0 and lists them here).
