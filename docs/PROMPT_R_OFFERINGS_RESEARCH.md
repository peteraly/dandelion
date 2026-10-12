# Dandelion Foundation — Prompt R: research every offering of every organisation (v1.0)

Founder direction (2026-10-12): research thoroughly all offerings, services, grants, projects and anything else each
organisation in the partner list provides, at the depth of this example the founders gave for NBC Tanzania:

> The National Bank of Commerce (NBC Tanzania) supports education and youth empowerment in Tanzania through
> student-focused financial products, vocational scholarships, and institutional partnerships.
> - **NBC Wajibika Scholarship**: with VETA, funds 3–6 month vocational courses (electrical, mechanical,
>   construction, hospitality) and links trainees to financial services and business mentoring.
> - **Student Savings Account**: for full-time students aged 18–25: subsidised fees, free Visa debit card,
>   interest, mobile and online banking.
> - **Silabu App partnership**: home-based digital financial literacy and saving habits for students.
> - **Essay Writing and Business Idea Competitions** (with the Ministry of Education) for secondary students.
> - **Mathematics performance support**: rewards for maths teachers; uniforms, textbooks and notebooks for top
>   Form Four students.
> - **School donations**: desks and cement for schools (for example in Mwanza).

The output feeds two things: the founders' partner sheet (one row per offering) and the website finder, which shows
each **opportunity** with its **organisation** to the people who qualify.

---

## The prompt

> **Role.** You are a careful research assistant for Dandelion Foundation, a Tanzanian non-profit (being
> registered) working on education, skills, economic opportunity and health for girls and young women, starting in
> Tanga Region.
>
> **Task.** For each organisation in the attached list, find every current offering that a girl, young woman,
> student mother, woman in business or farming, school, or partner organisation in Tanzania could use. An
> *offering* is anything specific and named that someone can receive or join: a scholarship, bursary, grant, prize,
> loan or guarantee, savings or bank product, training course or bootcamp, mentoring or incubation programme,
> internship or apprenticeship, competition, helpline, clinic or health service, app or digital service, product
> (including at a discount or donated), school programme, kit or meal programme, or a call for proposals for
> organisations. Name each one exactly as the organisation does.
>
> **For each offering, record:**
> 1. Organisation (as in the list).
> 2. Offering name (official name; add the Swahili name if it has one).
> 3. Type (from the list above).
> 4. What you get (amounts, duration, items, in plain words).
> 5. Who qualifies (age, gender, student status, region, income, business size, registration; "anyone" if open).
> 6. How to get it (apply online, through schools, branch, call, SMS code, app store; deadlines or yearly cycle).
> 7. Cost to the person (free, fee, interest rate, matching funds).
> 8. Where (national, named regions, Zanzibar; say if Tanga Region is included or not known).
> 9. Status and date (running, open call, closed, ended, unknown; the latest date you saw it confirmed).
> 10. Sources (one to three links; the organisation's own page first, then reputable news).
> 11. Who it is for, as tags: student under 18, student mother or pregnant, woman 18+ seeking skills or work,
>     business or farming, school or teacher, organisation or funder, general public.
>
> **Rules.**
> - Use only what you can cite. If you cannot confirm a detail, write "not stated" or "check". Never guess an
>   amount, an age limit or a deadline.
> - Prefer 2025–2026 sources. Mark programmes that ended (for example US-funded awards cut in 2025) as ended, not
>   current.
> - Tanzania first. Include regional or global offerings only if people or organisations in Tanzania can apply.
> - One row per offering. An organisation with no individual offering gets one row describing what it does, with
>   type "organisation only".
> - Public contact channels only (official numbers, websites, app listings). No personal names or private numbers.
> - Do not describe any organisation as a partner of Dandelion Foundation.
> - Some list entries are topics, not organisations (need summaries, money-map lines, partner roles, the 90-day
>   plan, context notes). Skip them and say so once.
>
> **Format.** A table (or tab-separated rows) with the eleven columns above, grouped by organisation in list
> order, then a short note of entries skipped and organisations where nothing current was found.
>
> **Quality bar.** Match the NBC example: several named offerings where they exist, each with eligibility, how to
> get it and a source. Breadth matters, but a wrong amount or a dead programme presented as open is worse than a
> missing row.

---

## How the response is delivered

- `docs/research/offerings.tsv`: one row per offering, the eleven columns above (paste into the partner sheet).
- `docs/research/OFFERINGS.md`: the same, readable by organisation, with the skipped entries and gaps.
- The website finder then lists offerings (opportunity + organisation) instead of one line per organisation.
