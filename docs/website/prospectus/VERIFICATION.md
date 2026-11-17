# Verification — Dandelion Foundation prospectus site

Checked on 2026-11-17 with `node verify.cjs`: **88 of 88 checks passed.**

- Browser: Chromium 153 (the full browser, run headless through Playwright), on Linux. Graphics were drawn in
  software, so WebGL was exercised but not on a real graphics card.
- The script serves this folder on a local port, opens the page, and reports one PASS or FAIL per check.
- To repeat it: `node verify.cjs` (needs the `playwright` package and a Chromium it can start; set `CHROMIUM_PATH`
  to choose the browser).

Every result below was produced by that run. Nothing here is a guess about other browsers or devices.

## What was checked

**At four window sizes: 320 × 640, 390 × 844, 768 × 1024 and 1440 × 900** (8 checks each)

- No script errors and no failed requests. (An earlier run caught a missing site icon this way; a plain placeholder
  icon was added.)
- The opening film is on.
- Scrolling forwards, scenes 1 to 5 appear in order.
- Scrolling back, scenes return in order and the cover is fully restored.
- The plate is painted on the cover and on the last scene (the pan from the first painting to the table plate).
- No sideways scrolling at nine positions down the page.
- Every request stays on the site: no fonts, scripts or pictures come from anywhere else.

**Structure and content**

- All ten section anchors exist (`vision`, `terms`, `focus`, `partners`, `resources`, `approach`, `about`,
  `collaborate`, `questions`, `closing`); no id is used twice; every in-page link has a target.
- One `h1`; every image has alt text.
- The copyright year is the current year.
- The delivery note under the brief buttons matches the required wording, character for character.
- The label "Symbolic artwork / Not impact data" is present.
- Six questions and five resources.
- External links carry `rel="noopener"`.

**Partners**

- Each of the five tabs shows only its own panel.
- Arrow keys move between tabs and wrap; End goes to the last.
- The plate beside the tabs is painted.
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
- When copying is blocked, the brief is shown for manual copying and the message points to Download.
- A page that embeds the site can supply its own save dialog (`window.DFHost.saveFile`); when one is present it is
  used with the same file name and text, and declining it shows "Download cancelled." and no error.

**Phone menu**

- The menu opens; Escape closes it and returns focus to the button.

**Reduced motion** (at 390 × 844 and 1440 × 900)

- The film is off; all five scenes read as an ordinary page; no live canvas exists.
- The cover headline fits its column; the still plates are painted; no sideways scrolling.
- The switch turns the film on, and back off.

**Without JavaScript** (390 × 844)

- The headline, the terms, all five partner groups, the resources, the questions and the delivery note are readable.
- The painting still shows and nothing scrolls sideways.

**Without WebGL**

- The film still runs, on the plain painter. The halftone figures print as flat tints.

**Opened straight from disk** (`file://`)

- The page works and the plate is painted, with fallback typefaces and the plain painter. Browsers block local font
  files and will not hand local pictures to WebGL; both are expected.

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

Gold is not used for text on paper. Text set over a painting always sits on its own slip of paper.

## Looked at by eye

Screenshots were reviewed at 320, 390, 768 and 1440 pixels wide for: the cover; each of the five scenes; the pan past
the pillar; the terms; the three figures; each partner tab with its gold ring; the shelf outline for each topic; the
approach sheet; the brief; the questions; the closing; the footer; and the still-page layout.

## Not checked

- **A real phone or tablet.** Sizes were emulated in a desktop browser.
- **Safari and Firefox.** Only Chromium was run.
- **A screen reader.** Roles, names and focus order were set with care, but none was listened to.
- **The external links.** The build environment could not reach other sites, so none of the resource or reference
  links was opened.
- **Speed.** No timing was taken on a slow phone or a slow network. Frame rates are not claimed.
- **The paintings at larger sizes.** The files are 1672 pixels wide; on large or sharp screens close views are a
  little soft.
