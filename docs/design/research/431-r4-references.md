# Round 4 of #431: references and design principles

Research for round 4 of the units, cities and provinces mockup
(`docs/design/mockups/tokens-cities-orders-r4.html`). The owner allowed references from the internet and game-dev design
guidance on 2026-10-29, strictly in the context of this game: a competitive 1v1 browser strategy on a map that is a graph
of cities and roads, top-down, abstract and neutral, small tokens read at small zoom (0.45), units that carry a charge.

What was looked at: cartographic symbol design and Bertin's visual variables, proportional symbols, Isotype, transit-map
symbols (stops and interchanges), relief and settlement symbols on topographic maps, glyph design in visualization,
preattentive perception, icon and game UI guidance (silhouette, small sizes, interior shapes), colourblind-safe design,
and minimalist graph strategy games. Shooters, action and character games were ignored.

No art was copied. The links below are read for principles only; every shape in round 4 is drawn by code from these
principles, and none borrows a known game's piece or a recognizable setting (the owner's rejections are listed in #431).

## Sources

| # | Source | Takeaway for this game | Inspired |
|---|---|---|---|
| 1 | [Axis Maps, Visual variables](https://axismaps.com/guide/visual-variables) | Shape is for categories and is never selective; size and value are ordered and pop out. So the **kind** of a place (city, province, capital) goes into the shape family, and the **charge** (an ordered, urgent quantity) goes into value or size, not into a subtle shape change | all; UP Phase, UQ Spark |
| 2 | [Visual variable (Bertin), Wikipedia](https://en.wikipedia.org/wiki/Visual_variable) | The seven variables (position, size, shape, value, colour hue, orientation, texture); value and size are dissociative, shape and hue associative. One quantity, one variable; do not spend two variables on the same thing unless it is redundancy on purpose | the shared rules |
| 3 | [Axis Maps, Proportional symbols](https://axismaps.com/guide/proportional-symbols) | Scale area, not radius; on small screens prefer a few graduated classes the reader can name. The city kinds (small, medium, large, capital) are classes, so they read better as a countable step (1, 2, 3 rings or tiers) than as a slightly bigger circle | CL Interchange, CM Terraces |
| 4 | [Isotype, Wikipedia](https://en.wikipedia.org/wiki/Isotype_(picture_language)) | "More symbols, not bigger symbols": a quantity is a row or a group of equal marks that can be counted. Units are a count, so a unit can be a group of equal marks | UN Cluster, UO Comet |
| 5 | [Trogu, Counting but losing count (Visible Language)](https://journals.uc.edu/index.php/vl/article/view/5954) | Counting repeated marks works for small numbers (about seven) and becomes a burden above; numerals carry larger values better. So marks are exact up to 6 or 7 and a numeral takes over above | UN Cluster, UR Twin, the 7-mark cap |
| 6 | [Birman, Designing Transit Maps: stops (bureau.ru)](https://bureau.ru/news/2024/book-metro-stops-en) | A stop is the simplest mark (a circle or a tick on the line); size, stroke and fill vary with importance. A province is a minor stop: a tick or a light ring on the road, not a heavy disc | PK Stop |
| 7 | [Birman, Designing Transit Maps: interchanges (bureau.ru)](https://bureau.ru/news/2024/book-metro-transfers-en) | An interchange is several stop circles joined into one sign; the number of joined circles tells how important the place is | CL Interchange, UR Twin |
| 8 | [Route diagram manual of style, Wikipedia](https://en.wikipedia.org/wiki/Wikipedia:Route_diagram_template/MOS) | Major and minor stations get different symbols, and a custom use needs a legend. Two clear classes of node (city, province) are enough; the capital is a marked major node | city vs province hierarchy |
| 9 | [Mini Metro, Wikipedia](https://en.wikipedia.org/wiki/Mini_Metro_(video_game)) | A graph map built from simple geometry and bold colour stays readable with many nodes; shape alone tells node types apart. Taken as a principle only; its station shapes are not reused | the flat, geometric family |
| 10 | [Borgo et al., Glyph-based visualization (Eurographics STAR 2013)](https://diglib.eg.org/handle/10.2312/conf.EG2013.stars.039-063) | Map the most important variable to the strongest channel; redundant mapping is good; keep glyph parts perceptually uniform. For a unit the charge is the most important variable, so it gets silhouette or value, the strongest channels | UQ Spark, UP Phase |
| 11 | [Healey, Perception in Visualization](https://www.csc2.ncsu.edu/faculty/healey/PP/index.html) | Length, size, lightness, closure and line ends are preattentive: they pop out before reading. A charged unit that is a long ray against a short stub, or a solid mark against a hollow one, is found at a glance | UQ Spark, UN Cluster |
| 12 | [BPXL, 10 essential tips for UI icons](https://medium.com/bpxl-craft/10-essential-tips-for-user-interface-icons-e7d04b5988a5) | A distinct silhouette matters more than colour or detail; judge an icon at its smallest size. Every variant is checked at 0.45 in grayscale before anything else | the check at 0.45 |
| 13 | [Unity Learn, Roughs: interior shapes and design](https://learn.unity.com/tutorial/roughs-interior-shapes-and-design) | A strong breakup of interior shapes makes a shape read faster than outline detail. Cities get big interior value steps (tiers, rings) instead of small rim marks | CM Terraces, CL Interchange |
| 14 | [Material Design, System icons](https://m2.material.io/design/iconography/system-icons.html) | Keylines: a circle, a square and a triangle need different sizes to look equally heavy; bold geometric shapes with consistent corners. All new unit shapes share one optical keyline, so no shape looks stronger only by its area | the unit keyline |
| 15 | [Tufte, Envisioning Information: layering and separation (lecture notes, Georgia Tech)](https://faculty.cc.gatech.edu/~stasko/7450/12/Notes/tufte.pdf) | Separate layers by value and weight so they do not blur: the background quietest, provinces light, cities medium, units strongest | province lightness, set rules |
| 16 | [OS, Relief representation](https://docs.os.uk/more-than-maps/geographic-data-visualisation/guide-to-cartography/relief-representation) and [Hypsometric tints, Wikipedia](https://en.wikipedia.org/wiki/Hypsometric_tints) | Discrete layer tints between contours give a stepped, countable look and read as height under one light. A city can be a small stepped plateau whose number of steps is its kind | CM Terraces, PL Contour |
| 17 | [USGS, Topographic map symbols](https://www.usgs.gov/publications/topographic-map-symbols) | Dense settlements are drawn as an area tint with only landmarks kept. A city can be an area (a footprint) with one landmark mark, not a building picture | CN Footprint, PM Field |
| 18 | [NATO Joint Military Symbology (APP-6), Wikipedia](https://en.wikipedia.org/wiki/NATO_Joint_Military_Symbology) | A symbol is a frame plus fixed amplifier slots around it, and shape and colour are redundant so it survives a monochrome display. Only the slot principle is kept (marks in fixed places around the sign); the frames themselves are the war-game look the owner rejected and are not used | fixed slots |
| 19 | [Bugnet, Colorblind-friendly game design](https://bugnet.io/blog/colorblind-friendly-game-design) | Never use hue alone; value differences survive every colour deficiency, so a grayscale screenshot is the test. Own and enemy differ by outline (single vs double), charge by value | the grayscale check |
| 20 | [Minimalist games, Foundations of Digital Games proceedings (ACM)](https://doi.org/10.1145/2159365.2159371) | Minimalist games keep small rule sets and abstract audiovisual representation without losing depth. The map should stay abstract: no setting is needed for a strategy to read | neutral language |

## Principles derived for round 4

1. **One variable per quantity.** Kind of place = shape family and a countable step; owner = colour plus outline (single own, double enemy, dashed grey neutral); charge = value or silhouette; size of a group = numeral (and, up to 6 or 7, the count of marks).
2. **Charge on the strongest channel.** The charge is the one number a player acts on, so it must survive 0.45 and grayscale: a lit (light) mark against a dark one, or a silhouette that grows with the charge. Fine detail (thin ticks, small notches) is only a bonus.
3. **Count up to about seven, then a numeral.** Repeated marks are exact up to 6 or 7, above that the marks show a proportion and the number is the truth.
4. **Graduated classes for cities.** Four kinds read as four countable steps (1, 2, 3 rings or tiers, plus a distinct capital), not as four nearly equal disc sizes.
5. **Layering by weight.** Provinces are the lightest layer (lines, tints, no solid body), cities medium, units on top and the most contrasted. A province must stay readable around a token, so its marks sit outside the token radius.
6. **Fixed slots around a sign.** Cells above, the B1 column on the left, VP at the upper right, the capital badge at the upper left, warehouse places under the sign, the caption under them; the sign shape changes, the slots do not.
7. **Silhouette first, judged small.** Each variant is judged at 0.45 in grayscale before the larger zooms.
8. **Neutral and original.** Geometry, cartographic and transit-map conventions are fine; no setting, no borrowed game piece, none of the rejected shapes (batteries, squares or blocks or cell grids, banners or flags, pawns and chess-like pieces, war-game counters, walls, towers, crenellations, bastions, gates).
9. **Bakeable.** Every look is one texture (or a small set: a body plus a lit mark) baked by `SpriteCache`, with no filter per object; a variant that needs per-object geometry at run time (rotation along a road) uses sprite rotation, not redrawing.
10. **Check unintended figures.** Round 3 found triangle + triangle = hexagram; round 4 checks every unit on every province (dots on dots, rays on dots, a ring on a ring).
