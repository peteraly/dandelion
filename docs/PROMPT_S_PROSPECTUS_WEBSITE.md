# Dandelion Foundation — Prompt S: a letterpress-prospectus website, in the manner of pear.no (v1.0)

Founder direction (2026-11-17), in the founder's words:

> *Write prompt and response to create a pear.no esque website for my nonprofit. Attached is info that may or may not
> be helpful.*
>
> *(With five paintings sent afterwards:)* *We don't have to use these specifically but they are good ideas. Whatever
> you recommend is the best.*

Part 1 says what "in the manner of pear.no" means and what we leave alone. Part 2 is the prompt, ready to paste into
Claude or any assistant, with the paintings attached. Part 3 is the response: the site that was built from it, where it
is, and what was checked. Part 4 lists the founders' decisions. The copy comes from the founders' own notes of
November 2026 (the attached text file); the truth and legal rules of Prompts P and Q still apply.

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
| Painted allegory | Figures tend and gild a pear tree | Women tend a towering dandelion: map and roots, stem and support, seed head, then a table with a plan |
| Print, not screen | Letterpress type, halftone, misregistration | Paper and four inks; headings printed slightly out of register; the paintings as tipped-in plates |
| Film you scrub | Scroll plays film sections | Scroll moves one slow camera across the paintings, forwards and backwards |

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
> terms first, illustrated with the attached oil-style paintings, which a slow camera explores as the visitor scrolls.
> The manner is borrowed from pear.no. Take the qualities listed below. Do not copy that site's name, its pear, its
> artwork, its words, its layout or its code, and do not suggest any link to it.
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
> 3. Paintings that carry the meaning, with short text beside them.
> 4. A printed look: paper, a few inks, type slightly out of register, plates and figures with captions.
> 5. Scroll moves a camera across the paintings. It is never a slideshow, and never a cross-fade between unrelated
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
> **The paintings (attached) and where each goes.**
> - **Plate I, the vision:** three women tend a towering golden dandelion on a hillside above the sea. Cover and
>   scenes 2 to 4.
> - **Plate II, the table:** four people around a map held down by river stones, a man at cedar shelves, arches onto
>   the sea. Scene 5, the partners section, the resources section.
> - **Plate III, planting:** two women plant a dandelion seed in a terracotta bowl. The approach section. Frame out the
>   hill town at the far left.
> - **Plate IV, the veranda at dusk:** a ledge with folded cloth, arches, palms, dhows, a lit lantern and one seed.
>   The about section (the ledge) and the closing.
> - Show every painting as it is. Never repaint, regenerate, stretch or animate what is in it. Only the camera moves,
>   slowly, with faces, hands and the map kept in frame. Keep zoom modest: the files are 1672 pixels wide.
> - Three things may be drawn on top, and nothing else: a few dandelion seeds leaving the seed head, a gold ring that
>   marks part of Plate II, and a gold box around one shelf.
> - If a painting is missing, build everything else, say which one is missing, and never substitute stock pictures.
> - Optional: three small figures drawn in code and printed as halftone (the taproot, the stem, the seed head) for the
>   three ideas in "Our focus".
>
> **The opening: five scenes, scrubbed by scroll.** A stage pins to the window for about six screens of scrolling. The
> camera's position depends only on how far the visitor has scrolled, so scrolling back plays it backwards. On wide
> screens the painting fills the stage and the text sits on slips of paper; on phones the painting is a plate at the
> top and the text sits below it. Use this copy:
> 1. *Cover.* Label: "Prospectus No. 1 / Tanga, Tanzania". Headline, set as a broadside with each line fitted to the
>    measure: "Learning / into / livelihoods." Text: "Health, education, and the opportunity to earn. Our mission is to
>    help women and girls connect the steps." The terms in brief: "01 One useful task · 02 An agreed scope · 03 A
>    shared review". Buttons: **Explore collaboration** (to the brief) and **Read the terms**. Note: "This website does
>    not accept donations or provide charitable tax receipts."
> 2. *The starting point* (the map and the roots). "Listen. Connect. Follow through." "Learn from women, educators,
>    and service providers. Understand what already works." "Identify the next practical step around locally defined
>    health and learning priorities."
> 3. *The contribution* (the stem and its support; the camera rises). "Build on what already exists." "Connect local
>    knowledge with useful resources, practical expertise, and follow-through." "Potential contributions include
>    resource mapping, coordination, documentation, and follow-up—agreed around a local host's priorities."
> 4. *The horizon* (the seed head; a few seeds leave). "Connect capability with demand." "Explore real employers,
>    customers, and women-led enterprise as routes toward income and independence." "From a useful service to a
>    stronger local industry, the direction depends on local ownership and a viable opportunity."
> 5. *The clear plan* (pan right, past the stone pillar at the edge of Plate II, to the table; the seeds come down on
>    the map). "A shared purpose. A clear plan." "A useful collaboration connects a local priority, the right
>    expertise, practical resources, and a way to learn." "Agree the task. Define responsibilities. Review what
>    happens. Then decide the next step."
>
> Give the opening five numbered buttons (one per scene), a switch that turns the film into an ordinary still page,
> and a link that skips to the terms.
>
> **The page below the opening, in this order. Use the copy word for word.**
> 1. **The terms.** "One task. One scope. One review." Three numbered steps, because this is a real sequence:
>    *01 Identify fit:* "Choose one useful task." "Share a priority, an existing resource, or an introduction. Keep the
>    first request small." *02 Agree the scope:* "Decide who does what." "Confirm capacity, costs, permissions,
>    responsibilities, and what a useful result would be." *03 Review together:* "Deliver, learn, then decide."
>    "Complete the agreed task and review the result before committing to more." Then: "Each collaboration is defined
>    by its agreed scope. Public acknowledgment requires each organization's permission." Then "In plain terms", six
>    lines: no donations or tax receipts through this website; participation would never require a purchase; a
>    discussion about materials or research does not provide access to participant data; the resources listed are
>    external, not Dandelion services or partners; the artwork is symbolic, not impact data; the drafting tool sends
>    nothing.
> 2. **Ch. 1 / Our focus.** "Rooted in local priorities. Built toward opportunity." "Dandelion brings health,
>    education, and economic opportunity into one connected mission for women and girls in Tanzania. Our focus in Tanga
>    is to identify a practical community priority and shape a useful collaboration around it." Three ideas:
>    *The starting point,* "Listen. Connect. Follow through." "Learn from women, educators, and service providers.
>    Understand what already works. Identify where coordination or practical support could make the next step easier."
>    *The contribution,* "Build on what already exists." "Potential contributions include resource mapping, partner
>    coordination, useful documentation, and follow-up—agreed around the priorities and capacity of a local host."
>    *The horizon,* "Connect capability with demand." "Explore existing training, employers, customers, and women-led
>    enterprise before considering new services, distribution, or local production." A drawer, "Read the story without
>    scrolling through the scenes", holds this transcript: "Our mission connects health, education, and pathways to
>    income for women and girls in Tanzania. Trusted information and practical support can help remove barriers.
>    Continued learning builds capability. Employers, customers, and local ownership help turn capability into
>    opportunity. Each collaboration needs a clear task, defined responsibilities, suitable resources, and a way to
>    learn."
> 3. **Ch. 2 / Work with us.** "Bring what works. Build what's missing." "A useful partnership starts with your
>    priorities, a concrete contribution, and a small ask." Five groups as keyboard-operable tabs beside Plate II. Each
>    shows a heading, a starting point, what we could contribute, a first question, a possible first output, and a
>    button that sets that group in the brief. Choosing a group moves the gold ring and leans the camera toward the
>    part of the painting that stands for it, and the view returns to neutral as the section leaves the window. Say
>    below: "Choosing a group here does not create or imply a partnership."
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
> 4. **Appendix / Useful resources.** "Find what already exists." "Start with a small set of public resources for
>    learning, health information, and practical skills in Tanzania." Notice: "These are external resources, not
>    Dandelion services or partners. Confirm current availability, eligibility, costs, local access, and privacy
>    directly with each provider." A search box, topic buttons (All topics, Health information, Learning, Skills &
>    business), Reset, a live count, and an empty state. Choosing a topic outlines one shelf in the painting. Five
>    entries, each with a "Check first" line and a link marked as external:
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
> 5. **Ch. 3 / Our approach** (a dark sheet beside Plate III). "Good work starts with clear principles." Four, not
>    numbered, because they are not a sequence: *Local voice, real authority.* "Local women and delivery partners
>    should help set priorities and decide what is feasible. Participation must be voluntary." *Build on existing
>    expertise.* "Learn from established approaches and use qualified providers. We will not create new services where
>    a useful connection will do." *Safety before speed.* "No participant-facing work without appropriate permissions,
>    supervision, safeguarding, and referral arrangements." *Evidence before expansion.* "Track useful next steps and
>    full costs, including donated time. Share limitations and grow only when the model warrants it."
> 6. **About** (anchor `#about`, used once). "Connecting purpose with practical action." "Dandelion connects health,
>    education, and pathways to economic opportunity for women and girls in Tanzania." "Our approach connects locally
>    led priorities in Tanzania with collaboration across the United States and internationally." "Each proposed
>    collaboration needs clear responsibilities, appropriate safeguards, and one useful result to review together."
> 7. **A first conversation** (anchor `#collaborate`). "What could we do together?" "Choose one priority and one
>    practical way to help. Start with a bounded task we can assess together." Four fields: Organization or team; Area
>    of work (the five groups, and "Something else"); Priority you are working on; Where a small collaboration might
>    help. Two buttons: **Copy formatted brief** and **Download .txt**. Each builds a dated plain-text brief at the
>    moment it is pressed: the entries, a suggested next step, "Exploratory only", and "No message was sent". Directly
>    under the buttons, word for word: "Delivery note: A public inbox is not yet active—this tool prepares a local
>    draft only and sends nothing. Omit student names or confidential health data, and copy or download your brief to
>    save it." No preview card. Success wording is "Copied to clipboard." and never "sent". If copying is blocked, show
>    the text for manual copying and point to Download.
> 8. **Ch. 4 / Questions.** Six, as native open-and-close rows:
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
> 9. **Closing** (under Plate IV, where a few seeds drift and the lantern glows). "The next chapter / Together."
>    "Shared purpose. Lasting possibility." "Start with a shared priority. Shape one useful next step." Button:
>    **Explore collaboration**.
> 10. **Footer.** "Dandelion Foundation. Health. Education. Economic opportunity. Women & girls / Tanzania." "Learning
>     into livelihoods." Links: About & accountability, Commitments, Questions, Collaborate. Privacy: "This page does
>     not submit collaboration entries. Copy or download your draft to keep it. Hosting providers may process technical
>     access logs. Do not enter sensitive information." A colophon naming the typefaces and saying the plates are
>     symbolic paintings of a fictional place. The current year.
>
> **Header.** A text wordmark, "Dandelion Foundation" (no invented logo), and: The vision, Our focus, Work with us,
> Questions, and a button, Explore collaboration. A skip link. On phones, a menu that Escape closes.
>
> **How it must behave.**
> - One scheduler drives everything that moves. Nothing is drawn when nothing is on screen or changing.
> - Every word is real text in the page. Nothing a visitor needs is inside a picture or a canvas.
> - The page reads in full without JavaScript, and the paintings still show.
> - Without WebGL the camera still works with a plain painter.
> - With "reduce motion" set, the opening is an ordinary page of five captioned stills, and nothing animates. The
>   switch lets a visitor choose either way.
> - While a field of the brief has focus, or the brief sits in the middle of the window, nothing on the page moves.
> - Nothing typed is sent, stored on the device, or put in the address bar. No cookies, no analytics, no outside
>   requests. Say this in the footer only if the finished code bears it out.
> - No sideways scrolling at 320, 390, 768 and 1440 pixels wide. Touch targets of at least 44 pixels. Visible focus.
>   Text contrast of at least 4.5 to 1, measured.
>
> **What to hand over.** Editable HTML, CSS and JavaScript with no build step; the paintings as received, plus a
> lighter size; the font files with their licences; a README; a list of every asset saying which were supplied, which
> were made, and which are still to come; and a check script with its results.
>
> **Before you finish, check, and report only what you actually ran:** the five scenes forwards and backwards at four
> widths; the pan past the pillar; every tab; search, filters, Reset, the count and the empty state; the six
> questions by keyboard; every in-page link; Copy and Download and their failure paths; the delivery note word for
> word; that nothing is sent or stored; reduced motion; no JavaScript; no WebGL; no sideways scrolling; no errors.
> Do not call a syntax check a browser test, and do not claim a phone test you did not do.

---

## Part 3 — The response

Built on 2026-11-17 by following the prompt above. Everything is in `docs/website/prospectus/`.

| File | What it is |
| --- | --- |
| `index.html` | The page: every word, as ordinary HTML |
| `styles.css` | Paper, inks, type, the two film layouts, every section |
| `stage.js` | The painted plates: camera, seeds, gold ring and box, print register |
| `figure.js` | The three halftone figures, drawn in code |
| `app.js` | Behaviour: film, tabs, finder, the brief, one scheduler |
| `assets/plates/` | The four paintings as received (1672 × 941), and a lighter 1100-pixel tier |
| `assets/fonts/` | Besley, Libre Franklin, Courier Prime, with their open licences |
| `README.md` | How to preview, publish, swap a painting, change copy |
| `ASSET-MANIFEST.json` | Every asset: supplied, made, or pending |
| `verify.cjs`, `VERIFICATION.md` | The browser checks and their results |

To look at it: `cd docs/website/prospectus && python3 -m http.server 8000`, then open `http://localhost:8000`.

**What was checked.** 88 checks in Chromium, all passing: four window sizes; the five scenes in order forwards and
backwards; no sideways scrolling; tabs by mouse and keyboard; search, filters, Reset and the empty state; questions by
keyboard; Copy, Download and the blocked-copy path; nothing sent, stored or put in the address bar; reduced motion; no
JavaScript; no WebGL; opened straight from disk; and ten text-contrast pairs (lowest 5.14 to 1). Details are in
`VERIFICATION.md`.

**What was not checked.** A real phone. Safari and Firefox. A screen reader. The external links (the build environment
could not reach them). Speed on a slow phone or network.

**What differs from the founders' earlier notes, and why.**
- The notes planned a dark page with one painted background from top to bottom. This build is a light, printed page
  where the paintings appear as plates between sheets of text. That is the pear.no manner, it keeps long text easy to
  read, and it means no text ever sits on a busy picture.
- The camera path uses the paintings supplied on the day (the hillside, the table, the veranda, the planting) instead
  of the ten-stop route in the notes, which assumed scenes that were not among them.
- Video clips (Kling) are not used. The camera is drawn live, so the film scrubs smoothly in both directions and weighs
  nothing extra. Clips can be added later; nothing depends on them.

---

## Part 4 — Decisions for the founders

1. **The name on the cover.** "Prospectus No. 1 / Tanga, Tanzania" is this build's own wording. Keep it, or choose
   another label.
2. **The paintings.** Four are used. The wide veranda panorama is held back: it is 667 pixels tall, it repeats scenes
   the sharper paintings already carry, and its figures are a different cast. Three things to decide: send
   full-resolution originals (the copies received are 1672 pixels wide, so close views are a little soft on sharp
   screens); whether to remake the planting painting, whose far-left background reads as an Italian hill town (it is
   framed out here); and how to credit the paintings in the colophon (artist or tool).
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
