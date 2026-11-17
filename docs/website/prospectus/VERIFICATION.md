# Verification — Dandelion Foundation prospectus site

Checked on 2026-11-17 with `node verify.cjs`: **114 of 114 checks passed.** This is the one-scene build (Prompt S
v1.1); the earlier build's 88 checks were replaced, because they tested a layout that no longer exists.

- Browser: Chromium 153 (the full browser, run headless through Playwright), on Linux. Graphics were drawn in
  software, so WebGL was exercised but not on a real graphics card.
- The script serves this folder on a local port, opens the page, and reports one PASS or FAIL per check.
- To repeat it: `node verify.cjs` (needs the `playwright` package and a Chromium it can start; set `CHROMIUM_PATH`
  to choose the browser).

Every result below was produced by that run. Nothing here is a guess about other browsers or devices.

## How the camera is checked

The page exposes a read-only `window.DFScene`: where the camera is, where it should be for the current scroll
position, and the stretch of scrolling over which each block of text holds. The script scrolls to the middle of each
block's hold, waits until the camera has glided to rest, and compares. "Settled" means within half a scene unit (a
painting is 1672 units wide) of its planned framing.

## What was checked

**At four window sizes: 320 × 640, 390 × 844, 768 × 1024 and 1440 × 900** (13 checks each)

- No script errors and no failed requests.
- The scene is on behind the page.
- For each of the 14 blocks of text, the camera settles on its planned framing.
- Each block of text is set over its own painting (the hillside, the table or the veranda).
- The journey runs one way through the scene, from the first painting to the last.
- The view never runs past either end of the scene.
- Every short slip is wholly on screen while its part of the scene holds.
- The artwork label is clear of every short slip.
- The painting is drawn.
- Scrolling back through all 14 blocks retraces the same path, to within one unit.
- Back at the top, the cover framing returns.
- No sideways scrolling at nine positions down the page. (An earlier run found 2 pixels at 320 wide: the two cover
  buttons on one line were wider than the column. They were made smaller at that width, and allowed to wrap.)
- Every request stays on the site: no fonts, scripts or pictures come from anywhere else.

**Structure and content**

- All ten section anchors exist (`vision`, `terms`, `focus`, `partners`, `resources`, `approach`, `about`,
  `collaborate`, `questions`, `closing`); no id is used twice; every in-page link has a target.
- One `h1`; every image has alt text, except the decorative copy of the first painting behind the page, which is
  hidden from screen readers (each block of text carries its painting's description instead).
- The copyright year is the current year.
- The delivery note under the brief buttons matches the required wording, character for character.
- The label "Symbolic artwork / Not impact data" is present.
- Six questions and five resources.
- External links carry `rel="noopener"`.

**Partners**

- Each of the five tabs shows only its own panel.
- Arrow keys move between tabs and wrap; End goes to the last.
- Choosing a group turns the camera to its part of the table (from the woman speaking to the books, the camera moves
  more than 400 units and settles there).
- A group's "Start a brief" button sets the matching area of work in the brief.

**Resources**

- Searching "veta" leaves 1 of 5; the Learning filter leaves 1 of 5.
- A search with no match shows the empty state and hides the list.
- Reset restores all five and selects All topics.
- The research drawer opens.

**Questions**

- A question opens and closes with the Enter key.

**The brief tool**

- An empty brief is not copied: the first missing field is named, marked invalid and focused.
- Copy shows exactly "Copied to clipboard." The copied text holds the entries (including characters such as `<` and
  `>` unchanged), a date, and the line "No message was sent".
- Download gives `dandelion-collaboration-brief-YYYY-MM-DD.txt` with the same text.
- Nothing is sent: no request of any kind follows Copy or Download, and nothing is added to the address.
- Nothing is stored: no cookies, no local storage, no session storage.
- No "sent" message is ever shown.
- With a brief field focused, scrolling does not move the print register of any heading.
- With a brief field focused, the scene is perfectly still: two pictures of it taken 0.9 seconds apart are identical,
  pixel for pixel.
- With the brief in the middle of the window and nothing focused, the same holds.
- Elsewhere the scene does move by itself: at the seed head and at the questions (the sea), two pictures taken 0.9
  seconds apart differ. This shows that the stillness checks above are not passing by accident.
- When copying is blocked, the brief is shown for manual copying and the message points to Download.
- A page that embeds the site can supply its own save dialog (`window.DFHost.saveFile`); when one is present it is
  used with the same file name and text, and declining it shows "Download cancelled." and no error.

**Phone menu**

- The menu opens; Escape closes it and returns focus to the button.

**Reduced motion** (at 390 × 844 and 1440 × 900)

- There is no moving scene; every picture and every block of text reads as an ordinary page; no live canvas exists.
- The cover headline fits its column; the still pictures are painted; no sideways scrolling.
- The switch turns the moving scene on, and back off. (On phones the switch is in the menu.)

**Without JavaScript** (390 × 844)

- The headline, the terms, all five partner groups, the resources, the questions and the delivery note are readable.
- The painting still shows and nothing scrolls sideways.

**Opened from a link to a section** (`index.html#questions`)

- The page lands at the questions, with the camera settled on the veranda; the painting in view is drawn. (It is
  fetched first, before the paintings further left.)

**Without WebGL**

- The scene still runs on the plain painter, settles on the seed head, and travels on to the table.

**Opened straight from disk** (`file://`)

- The page works and the scene is painted, settled on the table, with fallback typefaces and the plain painter.
  Browsers block local font files and will not hand local pictures to WebGL; both are expected.

**Text contrast** (WCAG 2 ratio, worked out from the colours in `styles.css`)

| Pair | Ratio |
| --- | --- |
| Body text on paper | 18.79 : 1 |
| Body text on tinted paper | 17.50 : 1 |
| Muted text on paper | 7.36 : 1 |
| Muted text on tinted paper | 6.85 : 1 |
| Link blue on tinted paper | 6.60 : 1 |
| Ochre labels on paper | 5.52 : 1 |
| Ochre labels on tinted paper | 5.14 : 1 |
| Text on the dark sheet | 17.52 : 1 |
| Muted text on the dark sheet | 11.26 : 1 |
| Gold labels on the dark sheet | 8.04 : 1 |

Gold is not used for text on paper. No text is ever set on the painting itself: every word sits on its own slip of
paper.

## Looked at by eye

Screenshots were reviewed at 1440 and 390 pixels wide for every block of text: the cover; Ch. 1; the four scenes;
the terms with the discs reached in turn; each partner group with its ring; the shelf outline for two topics; the
approach, about and the brief over the veranda; the questions; the closing; the footer. At 768 and 320 pixels wide:
the cover, the starting point, the horizon, the clear plan, the contribution and the closing. These reviews led to
the terms and partner panels moving to the right, the term discs moving to the stone, the compass and the basket, and,
on phones, the slips for the map and the table waiting at the top of the window.

## Not checked

- **A real phone or tablet.** Sizes were emulated in a desktop browser.
- **Safari and Firefox.** Only Chromium was run.
- **A screen reader.** Roles, names and focus order were set with care, but none was listened to.
- **The external links.** The build environment could not reach other sites, so none of the resource or reference
  links was opened.
- **Speed.** No timing was taken on a slow phone or a slow network. Frame rates are not claimed. The camera's glide is
  timed by the clock, not by frames, so a slow device should see the same journey, less smoothly.
- **The paintings at larger sizes.** The files are 1672 pixels wide; on large or sharp screens close views are a
  little soft.
