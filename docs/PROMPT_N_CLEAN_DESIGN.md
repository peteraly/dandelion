# Prompt N — A clean, calm look: what we learn from the World Bank sites

Founders, 2026-10-01: *"Update the theme and design, clean, not crowded, for the app, to that of the World Bank."*
Reference: five World Bank Group pages saved by the founders (home page; "Mobilizes record private capital" press
release; IFC "Private Capital Mobilization"; "Creating Jobs for a Better Future"; "Unlocking Women's Economic
Potential").

Part 1 is the response in plain language. Part 2 is the build prompt. Part 3 lists the founders' decisions.

---

## Part 1 — Response

### 1.1 The short answer

Yes. Dandelion can have the calm, trustworthy feel of the World Bank sites: deep blue and white, soft grey bands,
one idea per section, lots of space, short headings, a few big numbers with their source. Today the app is
crowded: purple, amber, green and blue boxes compete on the same screen, almost every block is a card with a
shadow, and every field screen ends with four large buttons.

**We copy the qualities, not the brand.** No World Bank name, logo, globe, photos, fonts or exact colours anywhere
in Dandelion. A customer, a seller or a donor must never think the World Bank runs or endorses Dandelion: that
would mislead people in an app where trust is everything, and the marks belong to the World Bank Group. Dandelion
keeps its own name and a small dandelion-yellow accent.

### 1.2 What makes those pages feel clean

Read from the five pages (their section styles are named in the page source, for example `section-xxhuge`,
`bg-neutrals-20`, `lp-3column-card`, `heading-vertical`, `bg-primary-blue`):

1. **One idea per section.** A section has one small label, one heading, one or two sentences, then at most three
   items. "Our targets" is three big numbers (300M, 250M, 80M), each with one line of text and a link.
2. **A lot of space.** Sections are far apart; text columns are narrow (about 65 characters); nothing touches the
   edge.
3. **Few colours, used for sections, not for items.** A deep blue band for the opening or one call to action,
   white, and two light greys that alternate behind sections. Links are a lighter blue. Status colours are rare.
4. **Small uppercase labels** above headings ("OUR PRIORITIES", "RESEARCH & PUBLICATIONS").
5. **Flat cards.** A number or an image, a title, one sentence, one link ("Learn more", "See the story"). Medium
   corners, a thin border or none, no heavy shadows.
6. **Numbers with their source.** "3.4 additional jobs are created in related industries for every job in the
   health sector. Source: World Bank Health Works." This fits Dandelion's public record exactly.
7. **Detail behind a link.** The long text of each card opens in a pop-up or a next page, not on the main page.
8. **Simple way-finding.** A breadcrumb ("Home › Gender") and a short "More" menu instead of long side lists.
9. **Plain news layout.** Place and date first, then short paragraphs, then a contact card.
10. **One even, open sans-serif** for everything (the IFC page uses Ubuntu from Google Fonts; the World Bank's own
    face is a licensed font we will not use).

### 1.3 Where Dandelion is crowded today

Measured in the code on 2026-10-01:

| Area | What crowds it | Evidence |
| --- | --- | --- |
| Colour | Purple brand plus amber, green, sky, red boxes on the same screen | `bg-amber-50` 32 times, `bg-green-50` 24, brand tints 14; `themeColor` `#7c3aed` |
| Cards | Nearly every block is a rounded card with a shadow, so nothing stands out | `.card` = `rounded-2xl … shadow-sm`; 28 lines using cards on the field home alone |
| Field footer | Every screen ends with a large amber "Report a problem", "Call", "WhatsApp" and "Lock account" | `components/shell.tsx` `FieldShell` |
| Admin top | Wordmark, name, open-demo chip, environment, live status, language, logout, demo guide, about 25 menu links, a guide line and a demo banner before the first content | `app/admin/(dash)/layout.tsx`, `components/admin-nav.tsx` |
| Words | A hint sentence under most headings and buttons; several notes stacked in one box | e.g. `app/shop/page.tsx` order rows |
| Type | System font; sizes chosen screen by screen | no font set in `app/layout.tsx` |

What is already right and stays: 17px text on phones, 48px touch targets, Swahili first, no photos of customers,
fast pages on 3G, the skeletons while loading.

### 1.4 The design we recommend: "Calm"

**Colour** (Dandelion's own values; every text pair checked at WCAG AA, 4.5:1 or better):

| Token | Value | Use | Contrast |
| --- | --- | --- | --- |
| `ink` | `#14213D` | Headings and body text | 16.0 on white, 14.6 on band |
| `muted` | `#5A6675` | Secondary text, labels | 5.9 on white, 5.4 on band |
| `primary` | `#1F4E8C` | Primary buttons, the one blue band, active menu | 8.3 with white text |
| `primary-strong` | `#163A69` | Hover, pressed, text on `primary-soft` | 9.9 on `primary-soft` |
| `primary-soft` | `#E8F0FA` | Selected menu item, information notes | — |
| `link` | `#1D6FB8` | Links | 5.2 on white, 4.8 on band |
| `surface` | `#FFFFFF` | Page and cards | — |
| `band` | `#F3F5F8` | Alternate section background | — |
| `line` | `#DDE3EA` | Borders and dividers | — |
| `accent` | `#F2B705` | Dandelion yellow: the logo mark and at most one highlight per screen; never text on white | 8.8 with `ink` on it |
| `success` / `success-soft` | `#1E7A46` / `#E7F4EC` | Status pills only | 4.7 |
| `warning` / `warning-soft` | `#7A5A00` / `#FFF4D6` | Status pills and the one warning per screen | 5.8 |
| `danger` / `danger-soft` | `#B42318` / `#FDECEA` | Errors, "Report a problem" outline | 5.8 |

**Type.** One family, **Noto Sans** (free, wide letters, excellent for Swahili and English, made for low-end
screens), in three weights (400, 600, 700), self-hosted so no request leaves the user's phone. Scale: 13 (labels),
15 (small), 17 (body), 20 (section heading), 24 (page heading), 32 (big numbers; 40 on desktop). Section labels are
13px uppercase with 0.08em letter spacing in `muted`.

**Space.** A 4px grid. Inside a card 16–20px; between items 12px; between sections 32px on a phone and 56px on a
desktop. Text no wider than 65 characters.

**Shapes.** Cards 8px corners with a 1px `line` border and no shadow; buttons and inputs 8px; pills fully round. A
shadow only on the sticky top bar and on dialogs.

**Patterns** (borrowed from the pages, built once as components):

1. **Page header**: breadcrumb (admin) or role (field), the page heading, one sentence.
2. **Section**: uppercase label, heading, up to three items, "See all" for the rest.
3. **Number card**: big number, one line of meaning, a small "Source" or "As of" line.
4. **List row**: title, one line, a status pill, a chevron; the whole row opens the details.
5. **One primary button per screen.** Everything else is an outline button or a text link.
6. **Bands**: white and `band` alternate behind sections on public pages; the deep blue band appears once.
7. **More behind a tap**: long help, history and settings sit in a "More" disclosure or the next page.

### 1.5 What changes, screen by screen

| Screen | After |
| --- | --- |
| Home (`/`) | A deep blue opening band with one sentence and two buttons (Order pads, Sign in); "How it works" in three steps; "The record" as three number cards with sources; a quiet footer (Privacy, Safety, Impact, Verify). |
| Shop (`/shop`) | The order card first; her orders as rows with one status pill; payment instructions as the only coloured box; reminders, meeting point and safety move into "Settings and safety". |
| Field home | The one thing to do now at the top; the balance as one number card; other lists as rows. The footer becomes one row: "Report a problem" (still one tap) and "Help", which opens a page with call, WhatsApp and lock account. |
| Order page | Status pill and one sentence, the one action, then "Order details" folded away. |
| Admin | A slim top bar (wordmark, name, language, sign out). The menu shows "Today" (Home, Approvals, Problems, Payments to check, Shop health) with the other groups folded. Each page starts with a breadcrumb, a heading and one sentence. The demo banner becomes one line. Admin home opens with the four counts as number cards, then rows. |
| Impact (`/impact`) | The World Bank's data-card pattern: number, meaning, source, date. |
| Verify (`/verify`) | The news layout: date and place line, plain paragraphs, the record. |
| Empty states | One sentence and one action. |

Dark mode is not part of this change: most screens are used outdoors in daylight, and the reference sites are light.

### 1.6 Risks and how they are handled

- **Being mistaken for the World Bank**: no marks, names, photos or copied files; a test fails if "World Bank"
  appears in any message catalogue or component.
- **Breaking flows**: tests find elements by `data-testid` and visible text, not by colour; no test id changes.
- **Slower pages**: one font family, three weights, Latin subset, self-hosted; no images added.
- **Losing safety affordances**: "Report a problem" stays one tap from every field screen; the help numbers stay
  one tap away.
- **Old screenshots in the deck**: regenerate with `npm run demo:screens` after each phase.

---

## Part 2 — The prompt: what to build, in order

> Read `AGENTS.md` first: this is Next.js 16. Before touching fonts, read
> `node_modules/next/dist/docs/01-app/01-getting-started/13-fonts.md` and
> `node_modules/next/dist/docs/01-app/03-api-reference/02-components/font.md`. Tailwind is v4 (`@theme` in
> `app/globals.css`).

**Ground rules.** Copy the qualities of the World Bank pages, never their identity: no World Bank Group name, logo,
globe mark, photographs, licensed fonts, CSS files or exact brand colours. Change no `data-testid`, no route, no
server action and no message key that a test reads. Keep 48px touch targets and the 17px phone base. Do one
phase per commit; after each, run typecheck, lint, unit, integration, demo and end-to-end tests, and regenerate the
demo screenshots.

### N1 — Tokens and base styles
- `app/globals.css`: replace the purple `--color-brand-*` scale with the Calm tokens of §1.4 as Tailwind v4 theme
  colours (`ink`, `muted`, `primary`, `primary-strong`, `primary-soft`, `link`, `surface`, `band`, `line`,
  `accent`, `success`, `success-soft`, `warning`, `warning-soft`, `danger`, `danger-soft`). Keep `brand-*` as
  aliases of the primary scale for one phase so nothing breaks, then remove them in N4.
- Rewrite `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-danger`, `.btn-warn`, `.card`, `.field`, `.label`,
  `.check`, `.badge` on the tokens: 8px corners, 1px `line` borders, no shadows, a 3px `primary` focus ring with
  offset. `.btn-warn` becomes an outline style (warning colour) so amber no longer fills large areas.
- The skeleton gradient uses `band` and `line`.
- `app/layout.tsx`: load Noto Sans (400, 600, 700, Latin subset) with `next/font`. Prefer `next/font/local` with the
  woff2 files committed under `app/fonts/` (the build must not depend on reaching Google); otherwise
  `next/font/google`. Set it on `<html>`; body background `band` on app screens, `surface` on public pages.
- `viewport.themeColor` and `app/manifest.ts` `theme_color` become `#1F4E8C`; `background_color` `#F3F5F8`.
- Add `tests/unit/design-tokens.test.ts`: read the token values from `app/globals.css` and assert every text and
  background pair in §1.4 meets 4.5:1.

### N2 — A small component set (`components/ui.tsx`)
- `PageHeader({ crumbs?, title, lede? })` — breadcrumb, heading, one sentence.
- `Section({ label?, title?, seeAll?, band?, children })` — uppercase label, heading, content, optional "See all".
- `Stat({ value, label, source? })` — the number card.
- `Row({ href?, title, detail?, status?, children? })` — the list row with a chevron when it links.
- `Pill({ tone })` — replaces `Badge` (keep `Badge` as a wrapper so callers keep working).
- `More({ summary, children })` — a styled `<details>` for anything secondary.
- `ErrorText` and `SuccessText` become one quiet `Notice` style: a 4px coloured edge on a soft background, never a
  fully coloured box.

### N3 — Shells
- `FieldShell`: a compact header (wordmark, role and name on one line, language and sign-out in a small menu). The
  footer becomes one row: "Report a problem" as an outline danger button and a "Help" link. New page
  `app/(field)/help/page.tsx` holds call, WhatsApp and "Lock my account" (the existing `/lock` flow is unchanged).
  The end-to-end tests that open the problem screen must still pass unchanged.
- `PublicShell`: wordmark with the yellow dot, language switch, and a footer with Privacy, Safety, Impact and
  Verify links. Public pages may be wider than `max-w-md` on desktop (`max-w-5xl` content, text still 65ch).
- Admin layout: a slim sticky top bar; the sidebar shows a "Today" group open and the rest folded (state kept per
  browser); `PageGuide` becomes the `PageHeader` breadcrumb; the environment label and live status move into the
  top bar as small pills; `DemoBanner` becomes one line with its link.

### N4 — Screens, in this order
1. Public: `/`, `/shop` (join, sign in, home), `/impact`, `/safety`, `/verify`, `/privacy`, `/login`, `/enroll`.
2. Field: home, order page, wallet, customers, problem report.
3. Admin: home, approvals, problems, payments, shop health, orders, then the rest.
4. The district map and ecosystem view: colours mapped to tokens (keep the shapes and motion).

For every screen apply the density rules: one primary button; at most one coloured box; at most three items per
section before "See all"; hints at most one sentence (longer help goes into `More`); status shown as a pill, not a
coloured card. Replace raw Tailwind palette classes (`stone-*`, `amber-*`, `green-*`, `sky-*`, `purple-*`,
`brand-*`) with token classes; at the end `grep` must find none outside the district map's legend.

### N5 — Copy trim
Go through `messages/en.json` and `messages/sw.json` for the screens touched: one sentence per hint, labels of one
to three words, buttons that say what happens ("Pay", "Send order", "Hand over"). Keep every key a test reads.

### N6 — Checks before each push
- Typecheck, lint, unit (including `design-tokens`), integration, demo and the 25 end-to-end tests pass.
- The existing axe accessibility checks pass; add axe to the home, shop and field home tests.
- A test fails if "World Bank" appears in `messages/*.json`, `components/` or `app/`.
- First-load font transfer at most 90 KB; no new external requests (the CSP stays as it is).
- Before-and-after screenshots from `npm run demo:screens` committed to the pull request description.

**Done when** every screen follows the density rules, the token test passes, no raw palette classes remain, all
suites are green, and the founders have approved the screenshots.

---

## Part 3 — Founders' decisions

| # | Question | Recommended |
| --- | --- | --- |
| 1 | Take the World Bank's qualities but none of its marks? | **Yes.** Required to avoid misleading anyone. |
| 2 | Colours: deep blue with a dandelion-yellow accent, or keep purple? | **Deep blue with yellow** (calmer, closer to the reference, still Dandelion's own). |
| 3 | Font: Noto Sans, Ubuntu (as on the IFC page), or the phone's own font? | **Noto Sans** (best for Swahili, free); the phone's own font if data cost matters most. |
| 4 | Order: public and shop first, then field, then admin? | **Yes**: customers and donors see the public screens first. |

## Review log

- 2026-10-01 — Written from the five saved pages and an audit of `app/globals.css`, `components/ui.tsx`,
  `components/shell.tsx`, `components/admin-nav.tsx` and the main screens. Contrast of every proposed text pair
  computed (all at least 4.5:1). Nothing built yet; waits on Part 3.
