# DESIGN.md

The design system for aidep. Written for humans and for coding agents: read this
before adding UI, and prefer an existing token or pattern over a new one.

Source of truth for values is `app/globals.css`. If this file and that file
disagree, the CSS is right and this file is stale.

---

## 1. Visual theme and atmosphere

**A register of dying model APIs.**

aidep publishes dated facts: what breaks, on what day, with the vendor page that
proves it. The site is built from the thing it publishes. A register row is an
identifier, a provider, a date and a source, set in mono. Everything else on a
page exists to get the reader to a row and then to the PR that acts on it.

Three things are ours and carry the brand:

- **The row.** Mono, tabular, dated, with a chip that says how many days are
  left. The calendar table is the product visible on the page, so it sits as
  close to the top as the headline allows.
- **The sun.** A half-set sun on a horizon rule. Sunset is the industry word for
  retiring an API, and the sun's height is a status. See §4.
- **The horizon as baseline.** Wherever the mark sits next to the name, the
  horizon rule is the text baseline and the sun rises to the x-height. The mark
  is set like a letter of the word.

The site is dark-first, sits on a faint engineered grid, and speaks in two
voices. A serif for sentences, ours. Mono for facts, which is most of the site.

**Stage.** aidep is weeks old. The site should look like a register kept by a
small team, not a platform. One page does most of the work; the other pages
exist because they are the product (`/dead`) or the trust (`/security`). Do not
add a page to look bigger.

**What this is not.** Not a gradient hero, not glassmorphism, not a floating
3D render, not an animated background, not a stat band. The grid is the only
texture. If a visual element does not tell the reader something true about
their code, it does not ship.

---

## 2. Color palette and roles

All colors are oklch so that light and dark share a hue and differ only in
lightness and chroma. Dark is the default and the one to design in. Never write
a hex, an rgb, or a Tailwind palette color (`gray-700`, `red-500`) into a
component.

### Surfaces and ink

| Token | Dark | Light | Role |
|---|---|---|---|
| `paper` | `oklch(13% 0.006 80)` | `oklch(97% 0.006 95)` | page background |
| `paper-raised` | `oklch(17% 0.006 80)` | `oklch(99% 0.004 95)` | panels, table surfaces |
| `paper-sunk` | `oklch(10% 0.005 80)` | `oklch(94.5% 0.006 95)` | code blocks, inset wells |
| `ink` | `oklch(94% 0.006 90)` | `oklch(20% 0.012 80)` | primary text, headlines, links |
| `ink-secondary` | `oklch(72% 0.008 85)` | `oklch(40% 0.012 80)` | body copy |
| `ink-muted` | `oklch(52% 0.008 85)` | `oklch(58% 0.01 80)` | labels, captions, table heads |
| `rule` | `oklch(25% 0.006 85)` | `oklch(88% 0.008 90)` | every border, the grid |
| `rule-strong` | `oklch(40% 0.008 85)` | `oklch(74% 0.01 90)` | kicker rules, button borders |

There is no accent token. Links are `ink` with an underline. Headlines are
`ink` with no coloured word in them: a coloured word in a headline reads as a
status chip, because colour on this site means status and nothing else.

### Status, and only status

| Token | Dark | Light | Means |
|---|---|---|---|
| `dead` / `dead-bg` | `oklch(70% 0.15 27)` / `oklch(22% 0.05 27)` | `oklch(50% 0.17 27)` / `oklch(95% 0.025 27)` | retired, calls fail today |
| `dying` / `dying-bg` | `oklch(78% 0.12 80)` / `oklch(23% 0.045 80)` | `oklch(55% 0.12 70)` / `oklch(95.5% 0.035 85)` | dated, still works |
| `clean` / `clean-bg` | `oklch(72% 0.11 155)` / `oklch(21% 0.04 155)` | `oklch(48% 0.09 155)` / `oklch(95.5% 0.03 155)` | nothing found, or migration verified |

Amber is `dying`. The favicon's sun is amber because the favicon is the dying
mark (§4), and that is the only place amber appears outside a chip or a table.

**Status is never color alone.** Every chip carries a word. A retired id is also
struck through (`.struck`), so it reads without color at all.

---

## 3. Typography

Two families, both loaded through `next/font/google` in `app/layout.tsx`.

- **Newsreader** for every sentence: `h1`, `h2`, `h3`, paragraphs, display
  figures. Weight 400 only; the face has enough contrast that bold reads as a
  different font. The optical-size axis is on, so the same family sets a 5.5rem
  headline and a 16px paragraph without looking like two fonts.
- **Geist Mono** for every fact and for the name. Kickers, nav, the wordmark,
  table heads, table bodies that hold identifiers or dates, chips, datelines,
  footer, code, commands. If it is a fact rather than a sentence, it is mono.

The `.label` class is the single most used thing in the system: 11px mono,
uppercase, tracked 0.14em, tabular numerals. Nav, kickers, chips, table heads
and the footer all use it. Reach for it before reaching for `text-xs`.

Scale:

| Use | Setting |
|---|---|
| hero headline | `text-[clamp(2.75rem,7.5vw,5.5rem)] leading-[0.95]` |
| closing headline | `text-[clamp(2.25rem,6vw,4rem)]` |
| page title | `text-5xl sm:text-6xl` |
| section head | `text-3xl sm:text-4xl` |
| step title | `text-2xl` |
| display figure | `.figure text-4xl sm:text-5xl`, at most one per page |
| step numeral | `.figure text-5xl text-ink-muted/60` |
| body | `text-base leading-relaxed` |
| table body | `font-mono text-[13px]` |
| wordmark | `font-mono text-xl leading-none`, lowercase |
| label | `.label` (11px mono caps) |

The contrast between a 5.5rem serif headline and an 11px mono label is the whole
typographic idea. Do not add sizes in between to soften it.

**Headlines say what the reader gets.** Read only the `h1` and `h2`s on a page,
top to bottom. That skim must tell a stranger what aidep is, what it opens, and
what happens after they install. "How it works" fails the test; "One PR per
retirement date" passes. No italic, no coloured word, no line that only sounds
good.

---

## 4. Component stylings

**Header.** Sticky, `border-b border-rule`, translucent paper with a light blur.
The lockup on the left, `.label` nav in the middle (`dead`, `security`), an
outlined `install` control on the right. One row. Collapses to lockup and
install below `md`. The theme toggle and the handbook and pricing links live in
the footer.

**Kicker (`Kicker`).** A 2rem hairline in `rule-strong` followed by a `.label`
in `ink-muted`. Sits above every section head and above the hero headline.

**Mark (`Mark`, `app/mark.tsx`).** A sun on a horizon rule, `currentColor`, no
gradient, no stroke. Three variants encode status: `clean` (full disc above the
rule), `dying` (half set), `dead` (a sliver). **`dying` is the identity.** It is
the only one of the three that is neither a dot nor a line, and it is the moment
aidep exists for. `clean` and `dead` are for chips and table states; never set
one as decoration in a band, because a status glyph next to nothing is a claim
about nothing. The viewBox of every variant ends at the bottom of the horizon
rule, so the rule is the bottom edge of the box.

**Lockup (`Wordmark`, `app/mark.tsx`).** The dying mark at `1ex` tall, so the
horizon is the baseline and the sun's top is the x-height, followed by `aidep`
in mono lowercase. The only way the mark and the name appear together. Used in
the header, the footer and the dashboard header; size it with `text-*` on the
wrapper.

**Favicon (`app/icon.svg`).** The dying mark on dark paper, sun in the dying
amber, horizon in ink, rule thickened to an eighth of the width so it survives
16px. The one warm dot in a tab bar of white glyphs on dark squares.

**Panel (`.panel`, `.panel-head`).** `paper-raised`, 1px `rule` border, 2px
radius. Optional head strip with a `.label`. Holds tables, code, the command
box, and the asides beside each step. No shadow.

**Command box.** A `.panel` with the command in mono and a `.label` cell on the
right saying what it costs you (`no account`). The prompt `$` is `ink-muted`.
This is the hero's one control.

**Button, primary.** `.label border border-ink bg-ink text-paper px-4 py-3`,
inverting on hover. Mono caps, like everything else that is a control.

**Button, outline.** `.label border border-rule-strong px-3 py-1.5 text-ink`,
filling with ink on hover. The header's install control.

**Table.** Inside a `.panel`. `table-fixed` with a `<colgroup>` so two tables
stacked on one page share column edges. Head row `.label text-ink-muted`, body
`font-mono text-[13px]`, rows `border-b border-rule last:border-b-0`. Dates
`tabular-nums`. Wrap in `overflow-x-auto`.

**Chip.** `.label px-1.5 py-0.5` with a status `-bg` and matching text color,
and a word in it.

**Step row (`Step`).** Three columns on `md`: a `.figure` numeral, title plus
body, and a `.panel` aside with a `.label` head. Rows separated by `divide-y`.

**Display figure.** One `.figure` per page, and it must be computed at render
from the registry or our own tables. A typed number is a fact that will rot,
which is the product's own thesis. If the honest value is small, print the
small value or print nothing; never pad it with a second number.

**Struck id (`.struck`).** Line-through in `dead`, text in `ink-muted`. For
anything retired.

**Theme toggle.** A `.label` text button cycling Auto, Light, Dark. `app/theme.tsx`.
Lives in the footer.

**Prose (`.handbook-prose`).** Styles `marked`'s output for `handbook/*.md` with
tokens only. Table heads and inline code are mono.

---

## 5. Layout

- **Shell:** `mx-auto max-w-6xl px-6`.
- **The grid field.** `.grid-field` on the marketing wrapper: 64px cells in
  `rule` at 55%, fixed to the viewport. Content scrolls over it. Panels sit on
  it; they do not try to align to it.
- **The pyramid.** The hero is a kicker, a headline, one paragraph, one control.
  Everything else, including the trust claims and the numbers, comes further
  down where it has room. Nothing in the hero competes with the headline.
- **Sections** are separated by `border-t border-rule` on the section itself
  with `py-20` inside. No cards as section containers.
- **Vertical rhythm** is 20 between sections, 10 between a head and its content,
  8 to 9 between a paragraph and its control.
- **Two columns** only where content is genuinely paired (the objection section,
  step rows). They stack below `md`.

---

## 6. Depth and elevation

Three surfaces and nothing else: `paper-sunk` below, `paper` the page,
`paper-raised` above. Elevation is the surface step plus a 1px `rule` border.
No `box-shadow` anywhere. The header's `backdrop-blur-sm` is the only blur and
it exists so the grid reads through the sticky bar.

Radius is 2px on panels and nothing on anything else.

---

## 7. Do's and don'ts

**Do**

- Use `.label` for anything that is metadata.
- Put every table inside a `.panel` and give it a `<colgroup>`.
- Put a text label on every status chip.
- Read the headlines alone before opening a PR that changes copy.
- Check both themes. Dark is default; set `data-theme="light"` in devtools for
  the other.
- Let wide content scroll inside its own container.

**Don't**

- No hex, rgb, or Tailwind palette colors in components.
- No shadows, gradients, or glass beyond the header blur.
- No accent. Red, amber and green are dead, dying and clean, and appear only on
  a chip, a table cell, a struck id, or the favicon.
- No coloured or italic word inside a headline.
- No bold in the display face.
- No typed number that the registry or a table could compute.
- No stat whose honest value you would rather hide.
- No second control in the hero.
- No animation beyond a color transition on hover.
- No icon-only controls without an `aria-label`.
- No new radius, font, spacing step or surface without changing this file first.

---

## 8. Responsive behavior

Tailwind's default breakpoints; `md` (768px) is the one that matters.

- Header: lockup and install stay; nav links hide below `md`. The footer
  carries the full nav at every width.
- Step rows: stacked below `md`, three columns above.
- Tables never reflow into cards. They scroll inside `overflow-x-auto`.
- The page body must never scroll horizontally. The hero mark is inside
  `overflow-hidden` for exactly this reason.

---

## 9. Agent prompt guide

```
Surfaces   bg-paper  bg-paper-raised  bg-paper-sunk
Text       text-ink  text-ink-secondary  text-ink-muted
Borders    border-rule  border-rule-strong
Labels     .label                 (11px mono caps, the metadata voice)
Status     bg-dead-bg/text-dead   bg-dying-bg/text-dying   bg-clean-bg/text-clean
Struck     .struck
Panels     .panel  .panel-head
Figures    .figure                (one per page, computed)
Mark       <Mark variant="clean|dying|dead" />   dying is the logo
Lockup     <Wordmark />
Shell      mx-auto max-w-6xl px-6
Radius     2px on panels only
Shadows    none
```

Prompt to paste when adding a page:

> Build this using only the tokens and classes in DESIGN.md. Dark is the default.
> Metadata is `.label`, sentences are Newsreader at weight 400, facts are Geist
> Mono. Tables sit inside `.panel` with a `<colgroup>`. Headlines are plain ink
> and say what the reader gets. Red, amber and green are reserved for dead,
> dying and clean, and every chip carries a word. At most one display figure,
> computed at render. No shadows, no gradients, no hardcoded colors. Verify it
> in both themes.

Before opening a PR that touches UI:

```sh
grep -rE "(bg|text|border)-(white|black|gray|slate|zinc|neutral|stone|red|amber|green|blue)-[0-9]" app/
grep -rnE "#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?\b" app/ | grep -v icon.svg
grep -rnE 'className="em|text-accent|text-link' app/
```

All three should return nothing.
