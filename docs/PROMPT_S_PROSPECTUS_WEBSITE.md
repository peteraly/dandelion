# Dandelion Foundation — Prompt S: a letterpress-prospectus website, in the manner of pear.no (v1.1)

Founder direction (2026-11-17), in the founder's words:

> *Write prompt and response to create a pear.no esque website for my nonprofit. Attached is info that may or may not
> be helpful.*
>
> *(With five paintings sent afterwards:)* *We don't have to use these specifically but they are good ideas. Whatever
> you recommend is the best.*
>
> *(After seeing the first build:)* *What's another way to combine or transform movements and all scenes to be part of
> a single scene, with text layered on top where relevant, lots of white space? Like 1–5, but the scenes (we can
> generate more in similar style) are the entire background. I like the fonts and styles and colors. Create people or
> objects or background movements if missing, or other scenes to bridge everything if needed.*

v1.0 showed the paintings as plates between sheets of text, with a five-scene film at the top. v1.1 makes the whole
page one scene: the paintings, joined side by side, stay behind the page from the cover to the footer, and every word
sits on a slip of paper laid over them. The fonts, inks and print effects are unchanged.

Part 1 says what "in the manner of pear.no" means and what we leave alone. Part 2 is the prompt, ready to paste into
Claude or any assistant, with the paintings attached. Part 3 is the response: the site that was built from it, where it
is, and what was checked. Part 4 lists the founders' decisions. Part 5 is a set of briefs for new paintings that can
join the scene. The copy comes from the founders' own notes of November 2026 (the attached text file); the truth and
legal rules of Prompts P and Q still apply.

---

## Part 1 — What we take from pear.no, and what we leave

### 1.1 What could be seen

pear.no could not be opened from the build environment: the network rules blocked it, and the same rules blocked the
design write-ups about it. What follows comes from search results only: an
[Awwwards listing](https://www.awwwards.com/sites/pear) (Honorable Mention, 14 August 2026), a
[DesignRush case study](https://www.designrush.com/best-designs/websites/pear-website-design) with its
[agency profile](https://www.designrush.com/agency/profile/pear), and a
[public style note](https://github.com/StevenDTJ/showcase-site-builder) that names the design language. Pear is a
growth studio in Norway. Its site is described as a **letterpress prospectus**: classical oil-painting imagery,
misregistered halftone type, and film sections that play as you scroll. It opens with its terms instead of a grid of
past work, and the whole site sells one idea. The paintings (figures tending a pear tree) make the promise easy to
picture while the words explain how it works.

Because the site itself was never seen, nothing here can be a copy of it. That is also the rule going forward.

### 1.2 The qualities we take

| Quality | On pear.no (as described) | On Dandelion's site |
| --- | --- | --- |
| One idea | The whole site sells one offer | "Learning into livelihoods." Everything else explains it |
| Terms first | Opens with the pricing model, not a portfolio | The cover states the terms; the first section is "One task. One scope. One review." |
| Says who it is not for | Caps its partnerships and names who it turns away | "In plain terms": no donations here, no purchase required, no participant data, nothing sent |
| Painted allegory | Figures tend and gild a pear tree | Women tend a towering dandelion: map and roots, stem and support, seed head; then a table with a plan; then a veranda at dusk |
| Print, not screen | Letterpress type, halftone, misregistration | Paper and four inks; headings printed slightly out of register; every word on a slip of paper laid over the painting |
| Film you scrub | Scroll plays film sections | The paintings are joined into one scene behind the whole page; scroll moves one slow camera through it, forwards and backwards |

### 1.3 What we leave

Pear's name, the pear, its paintings, its sentences, its layout and its code. **We copy the qualities, not the brand**,
as with the World Bank pages in Prompt N. The style note above says the same of its own method: sites made in this
manner must not infringe pear.no's or anyone else's rights.

### 1.4 Why this manner suits Dandelion

A prospectus is an honest form. It says what is offered, on what terms, and what is not promised. That is what the
founders' notes ask for on every page: no invented programmes, numbers, partners or registration; symbolic art labelled
as symbolic; a drafting tool that sends nothing and says so. In East Africa a *prospectus* is also what a school
publishes for the people it hopes will join it, which fits an organisation whose first word is learning.

---

## Part 2 — The prompt

> **Role.** You are the designer and front-end developer of a new website for Dandelion Foundation. Build the working
> site. Do not return a plan in its place.
>
> **Task.** Build one long page in the manner of a *letterpress prospectus*: a printed offer document that states its
> terms first. The attached oil-style paintings, joined side by side, make one continuous scene that stays behind the
> whole page, and a slow camera travels through it as the visitor scrolls. Every word sits on a slip of paper laid
> over the scene, with plenty of clear space around it. The manner is borrowed from pear.no. Take the qualities listed
> below. Do not copy that site's name, its pear, its artwork, its words, its layout or its code, and do not suggest any
> link to it.
>
> **Who we are (facts you may use).**
> - Dandelion Foundation. Tagline: "Learning into livelihoods."
> - Mission: connect health, education, and pathways to economic opportunity for women and girls in Tanzania.
> - Focus: Tanga, Tanzania. Approach: locally led priorities in Tanzania, supported by collaboration across the United
>   States and internationally.
> - A separate English tutoring business is under consideration. It is separate from Dandelion in accounts,
>   operations and responsibilities.
>
> **Never invent or imply:** completed programmes, participant counts, measured impact, clinical services, delivery
> agreements, partnerships, facilities, legal registration, a tax number, tax deductibility, donation processing,
> contact details, a founder's name, or a date on which links were checked. The paintings are symbolic. Never present
> them as a record of real people, places or delivery. Do not call any organisation a partner.
>
> **The qualities to take.**
> 1. One idea, stated on the cover; every section explains it.
> 2. Terms before anything else, and a plain list of what is *not* offered or promised.
> 3. Paintings that carry the meaning, with short text laid over them and plenty of clear space.
> 4. A printed look: paper, a few inks, type slightly out of register, slips of paper with a gold offset edge.
> 5. Scroll moves one camera through one scene. It is never a slideshow, and never a cross-fade between unrelated
>    pictures.
>
> **Look.**
> - Paper `#FAF9F6`, tinted paper `#F2F1ED`, key ink `#0B0A09`, burnished gold `#D49B35`, cobalt `#3B74B8`, red ochre
>   `#A8481F`. One light theme, by choice. Gold is never used for text on paper.
> - Type: a Clarendon for headlines (Besley), a Franklin-style grotesque for reading (Libre Franklin), a typewriter face
>   for labels and form entries (Courier Prime). Host the font files with the site. No request may leave the site.
> - Misregistered type: print each headline three times: a solid gold plate, a cobalt plate laid as a dot screen, and
>   the key on top, the two colour plates a little off the key. While the page is moving the plates slip further; when
>   it stops they settle. Hide the repeated words from screen readers; where that is not possible, fall back to a plain
>   offset shadow.
> - Square corners. Buttons carry an offset gold block that closes up when pressed. No drop shadows, no gradients, no
>   rounded cards.
> - A small label stays with the artwork: "SYMBOLIC ARTWORK / NOT IMPACT DATA".
>
> **The paintings (attached), joined into one scene.**
> - Join three of them side by side, left to right: **the hillside** (three women tend a towering golden dandelion
>   above the sea), **the table** (four people around a map held down by river stones, a man at cedar shelves, arches
>   onto the sea), and **the veranda at dusk** (a ledge with folded cloth, arches, palms, dhows, a lit lantern and one
>   seed). Let each join fall on something already painted: the sandstone pillar at the left edge of the table, and
>   the cedar posts where the table meets the veranda.
> - Leave out any painting whose edges cannot meet the others (here: the planting painting and the wide panorama). Do
>   not force a join with a fade.
> - Show every painting as it is. Never repaint, regenerate or stretch it. The camera moves, slowly, with faces, hands
>   and the map kept clear of the text. Keep zoom modest: the files are 1672 pixels wide. While the camera holds on a
>   part of the scene, the view stays inside one painting; it crosses a join only while travelling, or behind text.
> - A few small places may stir by a pixel or two, by displacing the picture, never by repainting it: the seed head
>   sways, open water shimmers, the boats ride a slow swell.
> - Drawn on top, and nothing else: seeds that leave the seed head and come down on the map; motes of dust in the
>   indoor light; a few seeds crossing the evening sky; a soft glow at the lantern; three numbered gold discs for the
>   terms; a gold ring for the partner groups; a gold box around one shelf.
> - If a painting is missing, build everything else, say which one is missing, and never substitute stock pictures.
>
> **One scene behind the whole page.** The scene stays in the window, behind the text, from the cover to the footer.
> Each block of text names the part of the scene it belongs to: the camera holds there while the block is read, and
> travels on when it leaves. The camera's position depends only on how far the visitor has scrolled, so scrolling back
> plays the journey backwards. On wide screens a short slip of paper sits to one side, alternating left and right, and
> the painting is clear beside it; a long section sits on a taller sheet to one side and scrolls past. On phones the
> painting fills the window and a short slip waits at the bottom, or at the top when the subject is low in the
> painting. Leave generous clear space between blocks, so the scene is seen on its own between them. Give the header a
> switch ("Still page" / "Play the scene") that turns the moving scene into an ordinary page of captioned pictures,
> and a thin gold line under the header that shows how far down the page the visitor is. Add a link that skips to the
> terms.
>
> **The journey, in this order. Use the copy word for word.**
> 1. *Cover* (the women and the seed head; on wide screens the cover sheet takes the left half). Label: "Prospectus
>    No. 1 / Tanga, Tanzania". Headline, set as a broadside with each line fitted to the measure: "Learning / into /
>    livelihoods." Text: "Health, education, and the opportunity to earn. Our mission is to help women and girls
>    connect the steps." The terms in brief: "01 One useful task · 02 An agreed scope · 03 A shared review". Buttons:
>    **Explore collaboration** (to the brief) and **Read the terms**. Note: "This website does not accept donations or
>    provide charitable tax receipts."
> 2. **Ch. 1 / Our focus** (the whole hillside). "Rooted in local priorities. Built toward opportunity." "Dandelion
>    brings health, education, and economic opportunity into one connected mission for women and girls in Tanzania.
>    Our focus in Tanga is to identify a practical community priority and shape a useful collaboration around it." A
>    drawer, "Read the story without scrolling through the scenes", holds this transcript: "Our mission connects
>    health, education, and pathways to income for women and girls in Tanzania. Trusted information and practical
>    support can help remove barriers. Continued learning builds capability. Employers, customers, and local ownership
>    help turn capability into opportunity. Each collaboration needs a clear task, defined responsibilities, suitable
>    resources, and a way to learn." The chapter's three ideas are told by the next three scenes.
> 3. *The starting point* (the map and the roots). "Listen. Connect. Follow through." "Learn from women, educators,
>    and service providers. Understand what already works." "Identify the next practical step around locally defined
>    health and learning priorities."
> 4. *The contribution* (the stem and its support; the camera rises). "Build on what already exists." "Connect local
>    knowledge with useful resources, practical expertise, and follow-through." "Potential contributions include
>    resource mapping, coordination, documentation, and follow-up—agreed around a local host's priorities."
> 5. *The horizon* (the seed head; a few seeds leave). "Connect capability with demand." "Explore real employers,
>    customers, and women-led enterprise as routes toward income and independence." "From a useful service to a
>    stronger local industry, the direction depends on local ownership and a viable opportunity."
> 6. *The clear plan* (on, past the stone pillar, to the table; the seeds come down on the map). "A shared purpose. A
>    clear plan." "A useful collaboration connects a local priority, the right expertise, practical resources, and a
>    way to learn." "Agree the task. Define responsibilities. Review what happens. Then decide the next step."
>
> **The page goes on over the scene, in this order. Use the copy word for word.**
> 1. **The terms** (over the map: a gold disc numbered 1, 2 and 3 on the river stone, the compass and the basket of
>    finished cloth, reached in turn as the steps are read). "One task. One scope. One review." Three numbered steps,
>    because this is a real sequence:
>    *01 Identify fit:* "Choose one useful task." "Share a priority, an existing resource, or an introduction. Keep the
>    first request small." *02 Agree the scope:* "Decide who does what." "Confirm capacity, costs, permissions,
>    responsibilities, and what a useful result would be." *03 Review together:* "Deliver, learn, then decide."
>    "Complete the agreed task and review the result before committing to more." Then: "Each collaboration is defined
>    by its agreed scope. Public acknowledgment requires each organization's permission." Then "In plain terms", six
>    lines: no donations or tax receipts through this website; participation would never require a purchase; a
>    discussion about materials or research does not provide access to participant data; the resources listed are
>    external, not Dandelion services or partners; the artwork is symbolic, not impact data; the drafting tool sends
>    nothing.
> 2. **Ch. 2 / Work with us** (the table). "Bring what works. Build what's missing." "A useful partnership starts with
>    your priorities, a concrete contribution, and a small ask." Five groups as keyboard-operable tabs. Each shows a
>    heading, a starting point, what we could contribute, a first question, a possible first output, and a button that
>    sets that group in the brief. Choosing a group turns the camera to the part of the table that stands for it,
>    marked by a gold ring: the woman speaking (community), the girl with the slate (schools), the books (health and
>    research), the basket of finished cloth (business), the pillar that holds up the arch (supporters). Say below:
>    "Choosing a group here does not create or imply a partnership."
>    - *Community & local organizations.* "Your community. Your priorities." / "Schools and local organizations know
>      what is useful—and what creates extra work." / "Help map existing resources, coordinate agreed next steps, and
>      document what your team wants to learn." / "Which one barrier could we help investigate without duplicating
>      your work?" / "A focused local resource map."
>    - *Schools & educators.* "Learning starts with local insight." / "Educators understand the everyday barriers to
>      attendance, participation, and learning." / "Help review existing materials, map student-support resources, and
>      coordinate a clearly scoped task." / "Is there one resource or learning barrier your team would like to review
>      together?" / "A review of one student-support resource."
>    - *Health specialists & researchers.* "Share expertise that already works." / "Useful information needs
>      appropriate expertise, local relevance, and clear limits." / "Help coordinate a review of an existing resource
>      with appropriately qualified local providers." / "Which existing material could benefit from a focused review
>      of relevance, accessibility, or appropriate use?" / "A scoped review of one existing resource."
>    - *Businesses, suppliers & employers.* "Opportunity needs real demand." / "Employers, suppliers, customers, and
>      local enterprises can clarify practical requirements." / "Help investigate one skill need, supply constraint,
>      product question, or customer requirement." / "What concrete requirement would make a useful first
>      investigation?" / "A short demand or supply brief."
>    - *Supporters & funders.* "Make a specific next step possible." / "Introductions, expertise, and carefully scoped
>      resources can support useful work." / "Help define an achievable contribution with clear responsibilities and
>      realistic costs." / "Is there one resource gap or relevant introduction we could assess together?" / "A scoped
>      resource-gap review."
> 3. **Appendix / Useful resources** (the shelves). "Find what already exists." "Start with a small set of public
>    resources for learning, health information, and practical skills in Tanzania." Notice: "These are external
>    resources, not Dandelion services or partners. Confirm current availability, eligibility, costs, local access, and
>    privacy directly with each provider." A search box, topic buttons (All topics, Health information, Learning,
>    Skills & business), Reset, a live count, and an empty state. Choosing a topic outlines one shelf in the painting.
>    Five entries, each with a "Check first" line and a link marked as external:
>    - Menstrual health guidelines & toolkits (Health information). "National reference materials for educators,
>      health providers, and organizations, published by UNICEF Tanzania." Check first: "Planning resources, not
>      personal medical advice or a clinical service."
>      `https://www.unicef.org/tanzania/documents/national-guidelines-and-toolkits`
>    - Oky Tanzania (Health information). "Menstrual-health learning and period-tracking information." Check first:
>      "Review current availability, privacy terms, and suitability before use."
>      `https://www.unicef.org/tanzania/stories/oky-app-tanzanian-girls`
>    - Shule Direct (Learning). "Tanzania-focused learning and teaching resources." Check first: "Confirm current
>      content, access requirements, and fees." `https://www.shuledirect.co.tz/`
>    - VETA training-centre directory (Skills & business). "Vocational training-centre and course information." Check
>      first: "Confirm centre status, admissions, costs, and course availability."
>      `https://veta.go.tz/vetcat/centre/listCentre`
>    - SIDO business-skills training (Skills & business). "Entrepreneurship and business-management training
>      information." Check first: "Confirm local delivery, prerequisites, and fees. Training is not a funding
>      guarantee." `https://me.sido.go.tz/en/entrepreneurship-and-business-skills-training`
>
>    Then a box, "If someone needs help now": **199**, Afya Call Centre, the Ministry of Health's free national phone
>    line for health advice; **116**, National Child Helpline, run by C-Sema, a free helpline protecting children and
>    women from violence. "These are public services in Tanzania, not Dandelion services." Show the numbers as text.
>    Then a drawer, "Research & approaches we study": CAMFED, BRAC and PlantPad, one line each, under the notice
>    "Independent references, not Dandelion partners or affiliations. Inclusion does not establish endorsement, local
>    implementation, or feasibility." No logos. Link only to official pages you have a source for.
> 4. **Ch. 3 / Our approach** (on a sheet over the veranda wall). "Good work starts with clear principles." Four, not
>    numbered, because they are not a sequence: *Local voice, real authority.* "Local women and delivery partners
>    should help set priorities and decide what is feasible. Participation must be voluntary." *Build on existing
>    expertise.* "Learn from established approaches and use qualified providers. We will not create new services where
>    a useful connection will do." *Safety before speed.* "No participant-facing work without appropriate permissions,
>    supervision, safeguarding, and referral arrangements." *Evidence before expansion.* "Track useful next steps and
>    full costs, including donated time. Share limitations and grow only when the model warrants it."
> 5. **About** (anchor `#about`, used once; the ledge with the folded cloth). "Connecting purpose with practical
>    action." "Dandelion connects health, education, and pathways to economic opportunity for women and girls in
>    Tanzania." "Our approach connects locally led priorities in Tanzania with collaboration across the United States
>    and internationally." "Each proposed collaboration needs clear responsibilities, appropriate safeguards, and one
>    useful result to review together."
> 6. **A first conversation** (anchor `#collaborate`; the ledge, held still). "What could we do together?" "Choose
>    one priority and one practical way to help. Start with a bounded task we can assess together." Four fields:
>    Organization or team; Area of work (the five groups, and "Something else"); Priority you are working on; Where a
>    small collaboration might help. Two buttons: **Copy formatted brief** and **Download .txt**. Each builds a dated
>    plain-text brief at the moment it is pressed: the entries, a suggested next step, "Exploratory only", and "No
>    message was sent". Directly under the buttons, word for word: "Delivery note: A public inbox is not yet
>    active—this tool prepares a local draft only and sends nothing. Omit student names or confidential health data,
>    and copy or download your brief to save it." No preview card. Success wording is "Copied to clipboard." and never
>    "sent". If copying is blocked, show the text for manual copying and point to Download.
> 7. **Ch. 4 / Questions** (the arches and the sea). Six, as native open-and-close rows:
>    - What is Dandelion's focus in Tanzania? "Our focus in Tanga is project development around locally defined health
>      and learning needs, with a longer-term interest in economic opportunity. Specific activities, participant
>      access, and delivery arrangements are agreed with the relevant local host before enrollment or delivery."
>    - How can I support the work? "Introductions, relevant resources, technical expertise, and carefully scoped
>      in-kind support can all be useful starting points. This website does not accept donations or provide charitable
>      tax receipts."
>    - How is this different from a supply giveaway? "Immediate needs matter. Our approach is to connect useful support
>      with learning and, over time, routes to income. Any supplies would respond to a verified need and include a
>      realistic plan for access and replenishment."
>    - Is the English tutoring business part of Dandelion? "No. A separate tutoring business is under consideration,
>      with separate accounts, operations, and responsibilities. Any future contribution would depend on actual surplus
>      and an appropriate written arrangement. Participation would never require a purchase."
>    - How are priorities and responsibilities agreed? "Local priorities, capacity, costs, permissions,
>      responsibilities, and review arrangements should be defined jointly before work begins. Each collaboration needs
>      a clearly scoped task and a shared understanding of what a useful result would be."
>    - Can we use your materials or collaborate on research? "We welcome a clearly scoped discussion about materials or
>      research. This does not provide access to participant data; any research requires appropriate permissions,
>      review, consent, safeguarding, and qualified local involvement."
> 8. **Closing** (over the veranda at dusk, where a few seeds drift and the lantern glows). "The next chapter /
>    Together." "Shared purpose. Lasting possibility." "Start with a shared priority. Shape one useful next step."
>    Button: **Explore collaboration**.
> 9. **Footer.** "Dandelion Foundation. Health. Education. Economic opportunity. Women & girls / Tanzania." "Learning
>     into livelihoods." Links: About & accountability, Commitments, Questions, Collaborate. Privacy: "This page does
>     not submit collaboration entries. Copy or download your draft to keep it. Hosting providers may process technical
>    access logs. Do not enter sensitive information." A colophon naming the typefaces and saying the scene is made of
>    symbolic paintings that do not show real people, facilities or results. The current year. The footer is a dark
>    sheet that comes up over the scene.
>
> **Header.** A text wordmark, "Dandelion Foundation" (no invented logo), and: The vision, Our focus, Work with us,
> Questions, and a button, Explore collaboration. A skip link. On phones, a menu that Escape closes.
>
> **How it must behave.**
> - One scheduler drives everything that moves. Nothing is drawn when nothing is on screen or changing.
> - Every word is real text in the page. Nothing a visitor needs is inside a picture or a canvas.
> - The page reads in full without JavaScript, and the paintings still show.
> - Without WebGL the camera still works with a plain painter.
> - With "reduce motion" set, the page is an ordinary page: each block of text with its picture beside it as a
>   captioned still, and nothing animates. The switch lets a visitor choose either way.
> - While a field of the brief has focus, or the brief sits in the middle of the window, nothing moves by itself, and
>   the camera holds exactly where the scroll position puts it.
> - A visitor who arrives from a link to a section lands there with the scene already in place; the painting in view
>   loads first.
> - Nothing typed is sent, stored on the device, or put in the address bar. No cookies, no analytics, no outside
>   requests. Say this in the footer only if the finished code bears it out.
> - No sideways scrolling at 320, 390, 768 and 1440 pixels wide. Touch targets of at least 44 pixels. Visible focus.
>   Text contrast of at least 4.5 to 1, measured.
>
> **What to hand over.** Editable HTML, CSS and JavaScript with no build step; the paintings as received, plus a
> lighter size; the font files with their licences; a README; a list of every asset saying which were supplied, which
> were made, and which are still to come; and a check script with its results.
>
> **Before you finish, check, and report only what you actually ran:** the camera's framing for every block of text,
> forwards and backwards, at four widths; that every short slip is wholly on screen while its part of the scene holds;
> that nothing moves by itself while the brief is in use, and that the scene does move elsewhere; every tab; search,
> filters, Reset, the count and the empty state; the six questions by keyboard; every in-page link; Copy and Download
> and their failure paths; the delivery note word for word; that nothing is sent or stored; reduced motion; no
> JavaScript; no WebGL; a link to a section; no sideways scrolling; no errors.
> Do not call a syntax check a browser test, and do not claim a phone test you did not do.

---

## Part 3 — The response

Built on 2026-11-17 by following the prompt above, and rebuilt the same day as v1.1. Everything is in
`docs/website/prospectus/`.

| File | What it is |
| --- | --- |
| `index.html` | The page: every word, as ordinary HTML. Each block of text names its part of the scene |
| `styles.css` | Paper, inks, type; the page as one scene behind slips, and as an ordinary page of stills |
| `stage.js` | The scene: the paintings in order, the framings, the camera, what is drawn on top, the small stirrings |
| `app.js` | Behaviour: the camera's journey, tabs, finder, the brief, one scheduler |
| `assets/plates/` | The paintings as received (1672 × 941), and a lighter 1100-pixel tier |
| `assets/fonts/` | Besley, Libre Franklin, Courier Prime, with their open licences |
| `README.md` | How to preview, publish, add a painting, change copy |
| `ASSET-MANIFEST.json` | Every asset: supplied, made, or pending |
| `verify.cjs`, `VERIFICATION.md` | The browser checks and their results |

To look at it: `cd docs/website/prospectus && python3 -m http.server 8000`, then open `http://localhost:8000`.

**The journey, as built.** The cover sheet takes the left half of the window, with the women and the seed head beside
it. Ch. 1 sits over the whole hillside. The camera then holds on the map and the roots, rises up the stem, holds on the
seed head while seeds leave it, and travels on past the stone pillar to the table, where the seeds come down on the
map. The terms are read over the map, with gold discs on the stone, the compass and the basket of cloth. The partner
groups turn the camera around the table. The resources are read beside the shelves. Past the cedar posts, the
approach, about and the brief sit over the veranda wall and ledge; the questions over the arches and the sea; the
closing over the lantern at dusk. Indoors, dust drifts in the light; the boats rock; the sea shimmers.

**What was checked.** 114 checks in Chromium, all passing. At four window sizes: the camera settles on its planned
framing for each of the 14 blocks of text, each over its own painting, in one direction through the scene, and
retraces the same path when scrolled back; every short slip is wholly on screen while its part of the scene holds,
and clear of the artwork label; no sideways scrolling. Also: tabs by mouse and keyboard, and the camera turning to
each group; search, filters, Reset and the empty state; questions by keyboard; Copy, Download, the blocked-copy path
and a host-supplied save; nothing sent, stored or put in the address bar; the scene perfectly still while the brief is
in use, and moving elsewhere; a link straight to a section; reduced motion; no JavaScript; no WebGL; opened straight
from disk; and ten text-contrast pairs (lowest 5.14 to 1). Details are in `VERIFICATION.md`.

**What was not checked.** A real phone. Safari and Firefox. A screen reader. The external links (the build environment
could not reach them). Speed on a slow phone or network.

**What differs from the founders' earlier notes, and why.**
- The notes planned a dark page with one painted background from top to bottom. v1.0 was a light page with the
  paintings as plates between sheets of text. v1.1 returns to the notes' idea of one painted background from top to
  bottom, at the founder's request, but keeps the light, printed pages: every word sits on paper, never on the
  painting itself.
- The camera path uses the three paintings that can be joined (the hillside, the table, the veranda) instead of the
  ten-stop route in the notes, which assumed scenes that were not among them. The planting painting and the panorama
  are not used; Part 5 describes paintings that would join.
- Ch. 1's three ideas are told once, by the scenes that follow it, in the scenes' wording. The slightly longer versions
  of the same three ideas in the notes ("Identify where coordination or practical support could make the next step
  easier"; "partner coordination, useful documentation"; "before considering new services, distribution, or local
  production") are not on the page. They can go back into the three scene slips if wanted.
- Video clips (Kling) are not used. The camera is drawn live, so the journey scrubs smoothly in both directions and
  weighs nothing extra. Clips can be added later; nothing depends on them.

---

## Part 4 — Decisions for the founders

1. **The name on the cover.** "Prospectus No. 1 / Tanga, Tanzania" is this build's own wording. Keep it, or choose
   another label.
2. **The paintings.** Three are used, joined into one scene. The planting painting and the wide veranda panorama are
   held back: neither has an edge that can meet the others, the planting painting's far-left background reads as an
   Italian hill town, and the panorama is 667 pixels tall with a different cast. Three things to decide: send
   full-resolution originals (the copies received are 1672 pixels wide, so close views are a little soft on sharp
   screens); whether to commission the joining paintings in Part 5; and how to credit the paintings in the colophon
   (artist or tool).
3. **Two versions of who we are.** The live site says "a U.S.–Tanzania public-private partnership" with pilots "in
   Tanga and Mbeya". The notes for this site say "locally led priorities in Tanzania, supported by collaboration across
   the United States and internationally", name Tanga only, and say nothing of registration. This build follows the
   notes. Choose one wording and use it in both places.
4. **The help lines.** 199 and 116 are listed as on the live site. `docs/WEBSITE_COPY.md` asks that they be confirmed
   before publishing.
5. **The links.** The five resource links are from the founders' notes; the CAMFED and BRAC links are from the Prompt R
   research; PlantPad has none. None could be opened from the build environment. Open each before launch.
6. **Swahili.** There is none yet. Add lines only after a native speaker has reviewed them.
7. **An inbox.** When there is an address for partners to write to, the delivery note changes and the brief could be
   sent from the page. That needs somewhere to receive it and a privacy review first.
8. **Where it lives.** Any static host will serve the folder as it is. Decide whether this replaces the Squarespace
   site or sits beside it, and whether the opportunity finder (231 listings) moves across.
9. **A legal line.** Once the wording on registration is settled (Prompt Q, ADR-046), add it to the footer.

---

## Part 5 — Briefs for new paintings that join the scene

The founder offered to make more paintings in the same style. The site works without them. Each panel below would
slot into the scene with no visible seam and make one part of the journey richer. The moving things that could be
made in code (seeds, dust in the light, rocking boats, shimmering water, the lantern's glow) are already there; people
can only come from new paintings.

### 5.1 What every new panel needs

- **The same hand** as the three in use: oil on canvas, visible impasto brushwork, warm light, rich colour that is not
  oversaturated: cobalt and indigo, burnt orange and red ochre, burnished gold, cream, sandstone and cedar brown.
- **The same place**: the Swahili coast near Tanga. Coral-stone arches and pillars, carved cedar, palms, dhows, terraced
  green hills, the Indian Ocean. Tanzanian women in kanga and kitenge cloth and headwraps, dignified and busy with their
  hands, never posing for the viewer.
- **Size**: 16:9 landscape, at least 3344 × 1882 pixels if the tool allows (twice the current files, so close views
  stay sharp), and never less than 1672 × 941. WebP or PNG.
- **Edges that join.** The left edge continues the right edge of the painting before it; the right edge continues the
  left edge of the painting after it. Put a full-height upright (a pillar, a post, a door frame, a palm trunk) in the
  outermost 6 to 8 per cent of the width, so the join can fall on it. Attach the neighbouring painting to the
  generator as a reference and say which edge must match.
- **Room for words.** Keep one side, about a third of the width, calm (sky, wall, sea or floor). Keep faces and hands
  within the middle 70 per cent of the height.
- **Nothing that reads as a real programme or service.** No text, signs, logos, flags, uniforms or brand names. No
  clinic, hospital, medical equipment or school building. No money changing hands. The scene is symbolic, and the label
  "Symbolic artwork / Not impact data" stays with it.

### 5.2 Panel A — "The path up to the house" (between the hillside and the table)

Why: the walk from the field to the table, so that "The horizon" and "The clear plan" are joined by a journey instead
of a cut, and the people at the table are seen arriving.

> An oil painting in the same style as the attached hillside painting, 16:9, warm late-morning light turning golden. A
> stone path climbs through a garden of red earth, flowering shrubs and young palms, from a hillside above the sea
> toward the open coral-stone arches of a house on the Swahili coast near Tanga, Tanzania. Two Tanzanian women walk up
> the path, unhurried: one in a cream-and-indigo cloth with a pale yellow headwrap carries a rolled map under her arm;
> one in a rust-orange striped cloth with an orange headwrap carries a coil of rope. A girl of about eleven in a white
> blouse and a navy pinafore runs ahead holding a small slate. A few dandelion seeds drift on the air. Left edge:
> continues the right edge of the attached hillside painting (deep blue sky with a bank of white cloud at upper right,
> the blue sea on the horizon at about two thirds of the height, terraced green hills, a flowering shrub in the lower
> corner). Right edge: a full-height sandstone pillar of the house, warm reddish brown, about 8 per cent of the width,
> matching the pillar at the left edge of the attached table painting. Keep the upper left third mostly sky. No text,
> no signs, no logos, no uniforms.

Where it goes: in `PAINTINGS` in `stage.js`, between `vision` and `table`. The camera crosses it on the way from the
seed head to the table, and "The clear plan" or Ch. 1 can be set over it.

### 5.3 Panel B — "Planting at golden hour" (between the table and the veranda)

Why: it brings back the idea of the fourth painting in a form that joins, gives the approach chapter a picture with
people in it, and lets the light fall gradually from afternoon (the table) to dusk (the veranda).

> An oil painting in the same style as the attached table and veranda paintings, 16:9, low golden afternoon light,
> warmer than the table painting but not yet dusk. On a stone veranda on the Swahili coast near Tanga, Tanzania, two
> Tanzanian women kneel at a low stone ledge and plant one dandelion seed in a terracotta bowl of red earth: one in a
> green-and-cream cloth with a matching headwrap presses the soil with her fingers; one in an indigo cloth holds a small
> clay jug of water. Folded kanga cloth rests beside them. Behind them a coral-stone arch opens onto palms and the sea.
> Left edge: continues the right edge of the attached table painting (a dark cedar shelf upright, full height, with the
> end of a shelf of woven baskets and folded patterned cloth). Right edge: a full-height dark cedar post, about 6 per
> cent of the width, matching the post at the left edge of the attached veranda painting. Keep the left third calm
> (stone wall and floor). No hill town, no domes, no cypress trees. No text, signs or logos.

Where it goes: in `PAINTINGS`, between `table` and `veranda`. Point the approach chapter at it (`data-shot` on that
block in `index.html`).

### 5.4 Adding a painting once it exists

1. Save it as `assets/plates/plate-5-path.webp` (any name will do), with a copy 1100 pixels wide in
   `assets/plates/lite/` under the same name.
2. Add `['path', 'plate-5-path']` to `PAINTINGS` in `stage.js`, in its place from left to right. Everything in the
   scene is placed relative to its own painting, so nothing else moves.
3. Give it framings in `FRAMES` (one rectangle for wide windows, one for tall ones) and, if wanted, a place that stirs
   in `STIR`.
4. Point a block of text at it in `index.html` with `data-shot`, and `data-shot-to` for a slow pan while it is read.
   For the still page, give that block a figure whose plate names the painting (`data-sheet`).
5. Run `node verify.cjs`. It checks that every block lands on its own painting and that the journey runs one way
   through the scene.
