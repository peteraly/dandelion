# Dandelion Foundation — the prospectus site

A one-page website in the manner of a letterpress prospectus: it states its terms first, shows the paintings as colour
plates, and moves a slow camera across them as you scroll. It was built from `docs/PROMPT_S_PROSPECTUS_WEBSITE.md`.

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
server). The page uses relative paths, so it works at a domain root or in a sub-folder. `verify.cjs`, `README.md`,
`VERIFICATION.md` and `ASSET-MANIFEST.json` are not needed on the live site.

After publishing, check three things on the live address: the footer's privacy line still holds (some hosts add their
own analytics), every external link opens, and the page works on a real phone.

## What is in the folder

| File | What it does |
| --- | --- |
| `index.html` | Every word on the page. Edit copy here. |
| `styles.css` | Colours, type and layout. The colour and type tokens are at the top. |
| `stage.js` | The painted plates: where the camera goes, the drawn seeds, the gold ring and box. |
| `figure.js` | The three small halftone figures (taproot, stem, seed head), drawn in code. |
| `app.js` | Behaviour: the opening film, tabs, the resource finder, the brief tool. |
| `assets/plates/` | The four paintings as received, and a lighter copy of each in `lite/`. |
| `assets/fonts/` | Besley, Libre Franklin and Courier Prime, with their licences (SIL Open Font License 1.1). |
| `verify.cjs` | Browser checks. Results are in `VERIFICATION.md`. |
| `ASSET-MANIFEST.json` | Every asset: supplied, made here, or still to come. |

## Change the words

All copy is ordinary text in `index.html`. Two things to keep in step when you edit:

- A heading with `class="misreg"` repeats its words in a `data-print` attribute. The script refreshes it when the page
  loads, so you only need to keep the two the same if you care about visitors without JavaScript.
- The delivery note under the brief buttons is checked word for word by `verify.cjs`. If you change it on purpose,
  change the `DELIVERY` line at the top of that file too.

To add a resource, copy one `<li class="res" ...>` block and set its `data-topic` to `health`, `learning` or `skills`.
The count and the filters pick it up.

## Swap or add a painting

Each plate is 16:9. Replace a file in `assets/plates/` with a larger one of the same shape and the same name, and
make a lighter copy about 1100 pixels wide in `assets/plates/lite/`. Nothing else changes: camera positions are
measured in a fixed grid of 1672 × 941 units per plate, whatever the file's real size. Larger originals will make the
close views sharper.

If a new painting is composed differently, adjust its framings in `stage.js`:

- `FRAMES` lists each view as `[x, y, width, height]` on that grid, once for wide windows and once for tall ones.
- `SPOTS` are the five places the gold ring goes on the table plate, and `SHELVES` the three shelf outlines.
- `HEAD` is the centre and radius of the seed head, where the drawn seeds start.

The paintings are never altered by the code. Only the camera moves; the seeds, the ring and the box are drawn on top.

## The opening film

The stage pins to the window for about six screens of scrolling. The timeline is in `app.js` (`measureFilm`): a list
of moments between 0 and 1, each with a framing. The camera position depends only on scroll position, so it plays
backwards when you scroll back.

- Wide windows: the painting fills the stage and the text sits on slips of paper.
- Phones and narrow windows: the painting is a plate at the top and the text sits below.
- Visitors who ask their device to reduce motion get an ordinary page of five captioned stills. The switch at the
  bottom of the stage ("Read as a still page") lets anyone choose either way.

Video clips are not used. If clips are made later, they can replace the live camera for a scene; nothing depends on
them.

## Check it

```bash
node verify.cjs
```

This needs the `playwright` package and a Chromium it can start. It serves the folder itself, opens the page at four
sizes and several settings, and prints one PASS or FAIL line per check. What it covers, and what it cannot, is in
`VERIFICATION.md`.

## Privacy, as built

- The brief tool builds its text in the browser. It sends nothing, stores nothing, and puts nothing in the address bar.
- The page sets no cookies, uses no local storage, and loads nothing from another site. Fonts and pictures are served
  from this folder.
- External links (resources, references) open in a new tab and leave the site.
