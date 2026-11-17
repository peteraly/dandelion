# Dandelion Foundation — the prospectus site

A one-page website in the manner of a letterpress prospectus. Three paintings, joined side by side, make one scene
that stays behind the whole page. As you scroll, a slow camera travels through the scene, and every word sits on a
slip of paper laid over it. It was built from `docs/PROMPT_S_PROSPECTUS_WEBSITE.md` (v1.2).

It is plain HTML, CSS and JavaScript. There is nothing to install and nothing to build.

## Look at it

```bash
cd docs/website/prospectus
python3 -m http.server 8000
```

Then open `http://localhost:8000`. Any static file server will do.

Opening `index.html` straight from disk also works, with two differences: browsers refuse to load local font files, so
you see fallback typefaces, and the paintings are drawn by the plain painter instead of the graphics card.

## Publish it

Upload the folder as it is to any static host (Netlify, Vercel, Cloudflare Pages, GitHub Pages, an ordinary web
server). The page uses relative paths, so it works at a domain root or in a sub-folder. These are not needed on the
live site: `verify.cjs`, `README.md`, `VERIFICATION.md`, `ASSET-MANIFEST.json`, and the planting painting
(`assets/plates/plate-4-planting.webp` and its copy in `lite/`), which the page does not use.

After publishing, check three things on the live address: the footer's privacy line still holds (some hosts add their
own analytics), every external link opens, and the page works on a real phone.

## What is in the folder

| File | What it does |
| --- | --- |
| `index.html` | Every word on the page. Edit copy here. Each block of text says which part of the scene it belongs to. |
| `styles.css` | Colours, type and layout. The colour and type tokens are at the top. |
| `stage.js` | The scene: the paintings in order, the framings, the camera, what is drawn on top, the places that stir. |
| `app.js` | Behaviour: the camera's journey, tabs, the resource finder, the brief tool, one scheduler. |
| `assets/plates/` | The paintings as received, and a lighter copy of each in `lite/`. |
| `assets/fonts/` | Besley, Libre Franklin and Courier Prime, with their licences (SIL Open Font License 1.1). |
| `verify.cjs` | Browser checks. Results are in `VERIFICATION.md`. |
| `ASSET-MANIFEST.json` | Every asset: supplied, made here, or still to come. |

## Change the words

All copy is ordinary text in `index.html`. Two things to keep in step when you edit:

- A heading with `class="misreg"` repeats its words in a `data-print` attribute. The script refreshes it when the page
  loads, so you only need to keep the two the same if you care about visitors without JavaScript.
- The delivery note under the brief buttons is checked word for word by `verify.cjs`. If you change it on purpose,
  change the `DELIVERY` line at the top of that file too.

The directory of local resources (232 entries) is a plain list in `index.html`, under "Appendix / Local resources". It
was taken from the live site's opportunity finder (`docs/website/opportunity-finder-squarespace.html`), with UNICEF's
guidelines added from the founders' notes. To add an entry, copy one `<li class="res" ...>` block and set two codes:

- `data-topic`, one letter: `H` Health, `S` Safety and legal help, `J` Skills and jobs, `B` Business and money,
  `E` Education, `P` Periods and hygiene, `A` Farming and food, `N` Clean energy, `Y` Youth and media, `F` Funding,
  `G` Government, `R` Research and data. Change the label in `<p class="res-topic">` to match.
- `data-aud`, one or more letters separated by spaces: `u` Student under 18, `m` Student mother or pregnant,
  `y` Woman 18+, skills or work, `b` Business or farming, `t` School or teacher, `o` NGO or funder, `p` General public.

The count, the search, both menus and "Show more" pick it up. Each topic lights one shelf in the painting (health,
safety and periods the top shelf; education, youth and research the second; the rest the scale and ruler); the
mapping is `SHELF` in `app.js`. If you add or remove entries, change `RESOURCES` at the top of `verify.cjs`.

## How the scene works

The page is a column of blocks (`<section class="track" data-track ...>`), each with one slip of paper inside
(`data-slip`). Each block names its place in the scene:

- `data-shot` is the framing (from `FRAMES` in `stage.js`) where the camera holds while the block is read.
  `data-shot-to`, if present, is a second framing it pans to as the block is read.
- `data-side="right"` puts the slip on the right on wide screens; otherwise it sits on the left. The subject goes in
  the clear part beside it.
- `data-port="top"` makes a short slip wait at the top of the window on phones, for subjects low in the painting.
  Otherwise it waits at the bottom.
- `data-role` ties a block to something drawn on the scene: `clock` (seeds leave the seed head), `plan` (they land on
  the map), `terms` (the three gold discs), `partners` (the gold ring, and the camera turning to each group), `shelves`
  (the outline around a shelf), `brief` (stillness while it is used) and `evening` (the lantern and drifting seeds).

A short slip stays put while its block is read. A long section (`slip-panel`) sits on a taller sheet that scrolls past.
Between blocks there is clear space, so the scene is seen on its own while the camera travels.

The camera's place depends only on how far the page has scrolled, so scrolling back plays the journey backwards. It
glides a little behind the scroll, at the same pace whatever the frame rate. While someone is writing in the brief, or
the brief is in the middle of the window, nothing moves by itself and the camera holds exactly where the scroll
position puts it.

- Wide windows: slips sit to one side, alternating left and right.
- Phones: the painting fills the window and a short slip waits at the bottom (or the top).
- Visitors who ask their device to reduce motion get an ordinary page: each block with its picture beside it as a
  captioned still. The switch in the header ("Still page" / "Play the scene") lets anyone choose either way.

Video clips are not used. If clips are made later, they can replace the live camera for a stretch; nothing depends on
them.

## Add or swap a painting

The paintings are listed left to right in `PAINTINGS` at the top of `stage.js`, each as `[name, file]`. Everything
else in the scene (framings, the gold ring's places, the shelves, the term discs, the lantern, where seeds land) is
placed relative to its own painting, so adding a painting to the list moves nothing else.

To add one:

1. Save it in `assets/plates/` as 16:9 WebP, with a copy about 1100 pixels wide and the same name in
   `assets/plates/lite/`.
2. Add `[name, file]` to `PAINTINGS` in its place.
3. Give it framings in `FRAMES`: `[x, y, width, height]` in a grid of 1672 × 941 units per painting (whatever the
   file's real size), once for wide windows and once for tall ones. Faces, hands and the map should stay clear of the
   slip.
4. Point a block at it with `data-shot`. For the still page, give that block a figure whose plate names the painting
   (`data-sheet`).
5. Run the checks.

The joins between paintings should fall on something upright that is already painted: today, the sandstone pillar at
the left edge of the table, and the cedar posts where the table meets the veranda. The camera crosses a join only
while travelling between blocks, or behind a panel of text. Part 5 of Prompt S has briefs for new paintings made to
join.

To swap a painting for a sharper copy of the same picture, replace the file with a larger one of the same shape and
the same name, and remake its `lite/` copy. Nothing else changes.

Other things you can tune in `stage.js`:

- `SPOTS`: the five places the gold ring goes on the table, one per partner group.
- `SHELVES`: the three shelf outlines for the resource topics. `MARKS`: the three term discs.
- `HEAD`: the centre and radius of the seed head, where the drawn seeds start. `LANTERN`: where the glow sits.
- `STIR`: up to three small places per painting that stir by a pixel or two (sway, shimmer or swell).

The paintings are never repainted by the code. The camera moves, the stirring places are displaced by a pixel or two,
and the seeds, dust, ring, discs and box are drawn on top.

## Check it

```bash
node verify.cjs
```

This needs the `playwright` package and a Chromium it can start. It serves the folder itself, opens the page at four
sizes and several settings, and prints one PASS or FAIL line per check (117 at present). What it covers, and what it
cannot, is in `VERIFICATION.md`. If Playwright cannot find its browser, point it at one:

```bash
CHROMIUM_PATH=/path/to/chromium node verify.cjs
```

The page exposes a read-only `window.DFScene` (where the camera is, where it should be, and where each block holds) for
these checks. Nothing on the page depends on it.

## Privacy, as built

- The brief tool builds its text in the browser. It sends nothing, stores nothing, and puts nothing in the address bar.
- The page sets no cookies, uses no local storage, and loads nothing from another site. Fonts and pictures are served
  from this folder.
- External links (resources, references) open in a new tab and leave the site.

## Embedding the page somewhere that blocks downloads

Some viewers that frame a page do not allow ordinary downloads. A host page can supply its own save dialog by defining
`window.DFHost = { saveFile: function (name, text) { /* return a promise */ } }` before the brief's Download button is
pressed. When it is there the site uses it; otherwise the browser's own download is used. It is optional.
