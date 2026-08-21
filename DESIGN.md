# DESIGN.md

The design system for aidep. Written for humans and for coding agents: read this
before adding UI, and prefer an existing token or pattern over a new one.

Source of truth for values is `app/globals.css`. If this file and that file
disagree, the CSS is right and this file is stale.

---

## 1. Visual theme and atmosphere

**A register of dying model APIs, set the way a terminal and a ledger would agree
to set it.**

aidep publishes dated facts: what breaks, on what day, with the vendor page that
proves it. The site is dark-first, sits its content on a faint engineered grid,
and speaks in two voices. A serif for the few sentences that are ours. Mono for
everything that is data, which is most of the site.

The references, and what each one gave us:

- **herdr.dev**: the hero (kicker with a leading rule, two-line headline with one
  accented word, a copyable command), the faint mark bleeding off the right edge,
  the numbered `01 / 02 / 03` rows with a mono panel beside each, and the
  stat band.
- **insforge.dev**: the grid field behind everything, bordered panels with a
  mono label strip, one disciplined accent.
- **antimattr**: the italic accent word inside a serif headline, the bracketed
  mono label `[like this]`, and the red strike-through for what is being deleted.

What we kept from the earlier broadsheet idea: Newsreader as the display face,
the restraint with color, status never conveyed by color alone. What we dropped:
the newspaper masthead, the drop cap, the rule pairs. They pointed at a printed
page when the references point at a screen.

**What this is not.** Not a gradient hero, not glassmorphism, not a floating
3D render, not an animated background. The grid is the only texture. If a visual
element does not tell the reader something true about their code, it does not
ship.

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
| `ink` | `oklch(94% 0.006 90)` | `oklch(20% 0.012 80)` | primary text, headlines |
| `ink-secondary` | `oklch(72% 0.008 85)` | `oklch(40% 0.012 80)` | body copy |
| `ink-muted` | `oklch(52% 0.008 85)` | `oklch(58% 0.01 80)` | labels, captions, table heads |
| `rule` | `oklch(25% 0.006 85)` | `oklch(88% 0.008 90)` | every border, the grid |
| `rule-strong` | `oklch(40% 0.008 85)` | `oklch(74% 0.01 90)` | kicker rules, button borders |
| `accent` | `oklch(78% 0.12 80)` | `oklch(55% 0.12 70)` | the one italic word, nothing else |
| `link` | `oklch(78% 0.09 80)` | `oklch(48% 0.1 70)` | inline links |

The accent is warm amber, the same hue family as `dying`, so the one accented
word on a page and the "34 days" chip read as the same temperature. Use it for
exactly one word per headline, via `.em`. Not for buttons, not for icons, not
for hover states.

### Status, and only status

| Token | Dark | Light | Means |
|---|---|---|---|
| `dead` / `dead-bg` | `oklch(70% 0.15 27)` / `oklch(22% 0.05 27)` | `oklch(50% 0.17 27)` / `oklch(95% 0.025 27)` | retired, calls fail today |
| `dying` / `dying-bg` | `oklch(78% 0.12 80)` / `oklch(23% 0.045 80)` | `oklch(55% 0.12 70)` / `oklch(95.5% 0.035 85)` | dated, still works |
| `clean` / `clean-bg` | `oklch(72% 0.11 155)` / `oklch(21% 0.04 155)` | `oklch(48% 0.09 155)` / `oklch(95.5% 0.03 155)` | nothing found, or migration verified |

**Status is never color alone.** Every chip carries a word. A retired id is also
struck through (`.struck`), so it reads without color at all.

---

## 3. Typography

Three families, all loaded through `next/font/google` in `app/layout.tsx`.

- **Display: Newsreader**, with the optical-size axis, normal and italic.
  `h1`, `h2`, `h3`, the wordmark, and display figures. Weight 400 only; the face
  has enough contrast that bold reads as a different font.
- **Body: Public Sans.** Paragraphs. That is nearly its only job.
- **Mono: Geist Mono.** The data voice. Kickers, nav, table heads, table bodies
  that hold identifiers or dates, chips, datelines, footer, code, commands. If
  it is a fact rather than a sentence, it is mono.

The `.label` class is the single most used thing in the system: 11px mono,
uppercase, tracked 0.14em, tabular numerals. Nav, kickers, chips, table heads,
stat captions and the footer all use it. Reach for it before reaching for
`text-xs`.

Scale:

| Use | Setting |
|---|---|
| hero headline | `text-[clamp(2.75rem,7.5vw,5.5rem)] leading-[0.95]` |
| closing headline | `text-[clamp(2.25rem,6vw,4rem)]` |
| page title | `text-5xl sm:text-6xl` |
| section head | `text-3xl sm:text-4xl` |
| step title | `text-2xl` |
| stat figure | `.figure text-4xl sm:text-5xl` |
| step numeral | `.figure text-5xl text-ink-muted/60` |
| body | `text-base leading-relaxed` |
| table body | `font-mono text-[13px]` |
| label | `.label` (11px mono caps) |

The contrast between a 5.5rem serif headline and an 11px mono label is the whole
typographic idea. Do not add sizes in between to soften it.

**The accented word.** One word per headline, italic, in `accent`, via
`<span className="em">`. It should be the word the sentence turns on:
*Before* it takes you down. Why not just ask *my* agent. Never two per headline,
never on a section head.

---

## 4. Component stylings

**Header.** Sticky, `border-b border-rule`, translucent paper with a light blur.
Mark plus wordmark on the left, `.label` nav in the middle, theme toggle,
dashboard and an outlined `install` control on the right. One row. Collapses to
mark, toggle and install below `md`.

**Kicker (`Kicker`).** A 2rem hairline in `rule-strong` followed by a `.label`
in `ink-muted`. Sits above every section head and above the hero headline. The
herdr idiom.

**Mark (`Mark`, `app/mark.tsx`).** Setting sun on a horizon rule, from the logo
system. `currentColor`, so it inherits ink. Three variants encode status: `clean`
(full disc above the rule), `dying` (half set, the default), `dead` (a sliver).
Inline in the header and footer at text size; large and at 6% opacity bleeding
off the hero's right edge. The favicon is `app/icon.svg`, the same geometry with
the rule thickened to an eighth of the width so it survives 16px.

**Panel (`.panel`, `.panel-head`).** `paper-raised`, 1px `rule` border, 2px
radius. Optional head strip with a `.label`. Holds tables, code, the command
box, and the asides beside each step. No shadow.

**Command box.** A `.panel` with the command in mono and a `.label` cell on the
right saying what it costs you (`no account`). The prompt `$` is `ink-muted`.

**Button, primary.** `.label border border-ink bg-ink text-paper px-4 py-3`,
inverting on hover. Mono caps, like everything else that is a control.

**Button, outline.** `.label border border-rule-strong px-3 py-1.5 text-ink`,
filling with ink on hover. The header's install control.

**Stat band.** A full-width strip between `border-y border-rule`, four cells
divided by `divide-x`, each a `.figure` over a `.label`. Numbers come from the
registry at render time where they can.

**Table.** Inside a `.panel`. `table-fixed` with a `<colgroup>` so two tables
stacked on one page share column edges. Head row `.label text-ink-muted`, body
`font-mono text-[13px]`, rows `border-b border-rule last:border-b-0`. Dates
`tabular-nums`. Wrap in `overflow-x-auto`.

**Chip.** `.label px-1.5 py-0.5` with a status `-bg` and matching text color,
and a word in it.

**Step row (`Step`).** Three columns on `md`: a `.figure` numeral, title plus
body, and a `.panel` aside with a `.label` head. Rows separated by `divide-y`.

**Struck id (`.struck`).** Line-through in `dead`, text in `ink-muted`. For
anything retired.

**Theme toggle.** A `.label` text button cycling Auto, Light, Dark. `app/theme.tsx`.

**Prose (`.handbook-prose`).** Styles `marked`'s output for `handbook/*.md` with
tokens only. Table heads and inline code are mono.

---

## 5. Layout

- **Shell:** `mx-auto max-w-6xl px-6`. Wider than before, to let the three-column
  step rows breathe.
- **The grid field.** `.grid-field` on the marketing wrapper: 64px cells in
  `rule` at 55%, fixed to the viewport. Content scrolls over it. Panels sit on
  it; they do not try to align to it.
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
- Put exactly one `.em` word in a hero or closing headline.
- Put every table inside a `.panel` and give it a `<colgroup>`.
- Put a text label on every status chip.
- Check both themes. Dark is default; set `data-theme="light"` in devtools for
  the other.
- Let wide content scroll inside its own container.

**Don't**

- No hex, rgb, or Tailwind palette colors in components.
- No shadows, gradients, or glass beyond the header blur.
- No second accent. Amber is the only one.
- No `.em` on section heads, buttons, or body copy.
- No bold in the display face.
- No animation beyond a color transition on hover.
- No icon-only controls without an `aria-label`.
- No new radius, font, spacing step or surface without changing this file first.

---

## 8. Responsive behavior

Tailwind's default breakpoints; `md` (768px) is the one that matters.

- Header: mark, toggle and install stay; nav links and the dashboard link hide
  below `md`. The footer carries the full nav at every width.
- Stat band: 2×2 below `md`, 1×4 above.
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
Accent     .em                    (one italic word per headline, amber)
Status     bg-dead-bg/text-dead   bg-dying-bg/text-dying   bg-clean-bg/text-clean
Struck     .struck
Panels     .panel  .panel-head
Figures    .figure
Mark       <Mark variant="clean|dying|dead" />
Shell      mx-auto max-w-6xl px-6
Radius     2px on panels only
Shadows    none
```

Prompt to paste when adding a page:

> Build this using only the tokens and classes in DESIGN.md. Dark is the default.
> Metadata is `.label`, prose is Public Sans, headings are Newsreader at weight
> 400. Tables sit inside `.panel` with a `<colgroup>`. At most one `.em` word in
> the headline. Red, amber and green are reserved for dead, dying and clean, and
> every chip carries a word. No shadows, no gradients, no hardcoded colors.
> Verify it in both themes.

Before opening a PR that touches UI:

```sh
grep -rE "(bg|text|border)-(white|black|gray|slate|zinc|neutral|stone|red|amber|green|blue)-[0-9]" app/
grep -rnE "#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?\b" app/ | grep -v icon.svg
```

Both should return nothing.
