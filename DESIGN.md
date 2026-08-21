# DESIGN.md

The design system for aidep. Written for humans and for coding agents: read this
before adding UI, and prefer an existing token or pattern over a new one.

Source of truth for values is `app/globals.css`. If this file and that file
disagree, the CSS is right and this file is stale.

---

## 1. Visual theme and atmosphere

**An editorial broadsheet about things that are dying.**

aidep publishes dated facts: what breaks, on what day, with the vendor page that
proves it. The design leans into that. Serif headlines over a sans body, generous
rules between sections, tabular numbers, and almost no color. It should read like
a page of record, not like a SaaS dashboard.

The reference points are GitHub's *mechanics* and a newspaper's *voice*. From
GitHub: three-state theming, density, monospace for identifiers, keyboard-first,
zero decoration that does not carry information. From the newspaper: the serif
display face, the horizontal rules, the restraint with color, and the assumption
that the reader came for the facts.

Dark mode is not a recolored light mode. It is the same broadsheet printed on
black newsprint: the paper goes warm-black, the ink goes warm-white, and the hues
stay exactly where they were.

**What this is not.** Not a gradient hero, not glassmorphism, not a floating
3D render, not an animated background. If a visual element does not tell the
reader something true about their code, it does not ship.

---

## 2. Color palette and roles

All colors are oklch so that light and dark share a hue and differ only in
lightness and chroma. Never write a hex, an rgb, or a Tailwind palette color
(`gray-700`, `red-500`) into a component. The app currently has zero hardcoded
colors and that is worth keeping.

### Surfaces and ink

| Token | Light | Dark | Role |
|---|---|---|---|
| `paper` | `oklch(97.5% 0.006 95)` | `oklch(17% 0.008 85)` | page background |
| `paper-raised` | `oklch(99% 0.004 95)` | `oklch(21% 0.008 85)` | cards, table headers, anything one step above the page |
| `ink` | `oklch(24% 0.015 80)` | `oklch(93% 0.008 90)` | primary text, headlines |
| `ink-secondary` | `oklch(42% 0.012 80)` | `oklch(76% 0.01 85)` | body copy, nav links at rest |
| `ink-muted` | `oklch(58% 0.01 80)` | `oklch(62% 0.01 85)` | captions, footers, table meta |
| `rule` | `oklch(88% 0.008 90)` | `oklch(32% 0.008 85)` | every border and divider |
| `link` | `oklch(45% 0.09 240)` | `oklch(74% 0.11 240)` | inline links only |

Note that `paper-raised` is *lighter* than `paper` in both themes. Elevation is
always toward the light source, which inverts along with everything else.

### Status, and only status

Three colors carry meaning and are never used for decoration, emphasis, or
branding.

| Token | Light | Dark | Means |
|---|---|---|---|
| `dead` / `dead-bg` | `oklch(50% 0.17 27)` / `oklch(95% 0.025 27)` | `oklch(70% 0.15 27)` / `oklch(28% 0.055 27)` | already retired, calls fail today |
| `dying` / `dying-bg` | `oklch(55% 0.12 70)` / `oklch(95.5% 0.035 85)` | `oklch(78% 0.12 80)` / `oklch(29% 0.05 80)` | dated for retirement, still works |
| `clean` / `clean-bg` | `oklch(48% 0.09 155)` / `oklch(95.5% 0.03 155)` | `oklch(72% 0.11 155)` / `oklch(27% 0.045 155)` | nothing found, or migration verified |

**Status is never color alone.** Every status chip carries a text label, because
a red pill with no word in it is invisible to a colorblind reader and meaningless
in a screenshot. This is a hard rule, not a preference.

### Contrast floor

Body text meets WCAG AA (4.5:1) against its own surface in both themes.
`ink-muted` sits closest to the line, so do not use it for anything a reader must
read to act, only for provenance and timestamps. Status text on its matching
`-bg` clears 4.5:1 in both themes; status text on plain `paper` clears it
comfortably.

---

## 3. Typography

Two families, loaded through `next/font/google` in `app/layout.tsx`.

- **Display: Newsreader** (serif, normal and italic). `h1`, `h2`, `h3`, and the
  wordmark. Applied globally in `globals.css`, so a heading needs no class.
- **Body: Public Sans**. Everything else, including tables and buttons.
- **Mono: the system stack.** Model ids, file paths, env var names, and anything
  a reader might copy. Use Tailwind's `font-mono`; there is no custom mono face
  and there does not need to be.

Scale in use, smallest to largest. Stick to these; a new size needs a reason.

| Class | Used for |
|---|---|
| `text-xs` | table meta, footers, provenance lines, chips |
| `text-sm` | nav, body copy in dense areas, table cells |
| `text-base` | default paragraph |
| `text-2xl` | the wordmark, section headings |
| `text-4xl` | page titles |

Rules that matter more than the scale:

- `leading-relaxed` on any paragraph over one line.
- `max-w-xl` for reading columns, `max-w-2xl` for wider prose, `max-w-5xl` for
  the page shell. Never let a line of prose run the full page width.
- Numbers in tables are `tabular-nums` so columns of file counts align.
- Small caps labels are `text-xs uppercase tracking-wide text-ink-muted`.
- `font-medium` is the heaviest weight in the body face. There is no bold body
  text; emphasis comes from color and position.

---

## 4. Component stylings

These already exist. Match them rather than inventing a variant.

**Header nav.** A `border-b border-rule` strip, `max-w-5xl` inner, items
`text-sm text-ink-secondary hover:text-ink`. No active-state underline; the page
title says where you are.

**Button, primary.** `bg-ink text-paper px-5 py-2.5 rounded-sm font-medium`.
Inverted ink on paper. One per view, at most.

**Button, secondary.** `border border-rule px-3 py-1.5 text-ink-secondary
hover:border-ink-muted hover:text-ink`. The border darkens on hover, the fill
never changes.

**Status chip.** `px-2 py-0.5 rounded-sm text-xs` with a `-bg` background and its
matching text color, plus a word. `bg-dead-bg text-dead` reading "retired", not a
bare dot.

**Table.** Header row `border-b border-rule text-xs uppercase text-ink-muted`,
body rows `border-b border-rule py-2`, last row keeps its border. Left-align
text, right-align numbers. Wrap in `overflow-x-auto` so a wide table scrolls
inside itself instead of scrolling the page.

**Card.** `bg-paper-raised border border-rule rounded-sm p-6`. No shadow.

**Link.** `text-link underline underline-offset-2`. Inline links are underlined
always, not only on hover, because an underline is the only cue that survives
both themes and colorblindness.

**Theme toggle.** A single text button cycling Auto, Light, Dark, back to Auto,
labelled with the current state. `app/theme.tsx`.

**Prose.** `.handbook-prose` in `globals.css` styles the HTML that `marked`
renders from `handbook/*.md`. It uses tokens only and mirrors the rules the
hand-built pages follow, so a handbook page and `/security` read as one document.
There is no `@tailwindcss/typography`; if prose needs a new element style, add it
to that block rather than reaching for the plugin.

---

## 5. Layout

- **Shell:** `mx-auto max-w-5xl px-6`. Every page uses it.
- **Spacing scale:** 2, 3, 6, 12, 16, 24 in Tailwind units. `py-2`/`py-2.5` for
  dense rows, `gap-3` between related controls, `px-6` page gutter, and section
  spacing in multiples of 12.
- **Sections are separated by rules, not by cards.** A `border-t border-rule`
  with space above and below is the default divider. Reach for a card only when
  content genuinely needs a surface of its own.
- **Whitespace is vertical.** Generous space between sections, tight space inside
  a row. A dense table under an airy heading is correct.
- **One column by default.** Two columns only where the content is genuinely
  paired, and they stack below `md`.

---

## 6. Depth and elevation

There are two levels and no shadows.

1. `paper` is the page.
2. `paper-raised` plus `border border-rule` is anything above it.

Depth is expressed by the border and the one-step surface change. No `box-shadow`
anywhere, no blur, no layered translucency. On a broadsheet nothing floats.

`rounded-sm` is the only radius. Not `rounded-lg`, not `rounded-full` except on a
genuine avatar.

---

## 7. Do's and don'ts

**Do**

- Reach for an existing token. If you need a color that is not in the table, the
  answer is usually that you do not.
- Put a text label on every status.
- Underline inline links.
- Let wide content scroll inside its own container.
- Use `font-mono` for anything the reader might copy into a terminal.
- Check both themes before you commit. Setting `data-theme="dark"` on `<html>` in
  devtools is enough.

**Don't**

- No hex, rgb, or Tailwind palette colors in components.
- No shadows, gradients, or glass. Pryzm gradients and Dither textures are for
  standalone imagery (social cards, mascot art), never for UI chrome.
- No status conveyed by color alone.
- No animation beyond a color transition on hover. Nothing moves on scroll,
  nothing fades in, nothing parallaxes.
- No icon-only controls without an `aria-label`.
- No third font. Two families and the system mono stack is the whole set.
- No new radius, no new shadow, no new spacing step without changing this file
  first.

---

## 8. Responsive behavior

Tailwind's default breakpoints; the ones that matter are `md` (768px) and
`lg` (1024px).

- The shell is `max-w-5xl px-6` at every size. Below `md` the padding carries it.
- Nav collapses to the wordmark plus the two most important links below `md`.
  There is no hamburger drawer; the site has four pages.
- Two-column layouts stack at `md`.
- Tables never reflow into cards. They scroll horizontally inside
  `overflow-x-auto`, because the columns are the comparison and stacking them
  destroys it.
- The page body must never scroll horizontally at any width.

---

## 9. Agent prompt guide

Quick reference for generating UI in this codebase.

```
Surfaces   bg-paper  bg-paper-raised
Text       text-ink  text-ink-secondary  text-ink-muted
Borders    border-rule
Status     bg-dead-bg/text-dead   bg-dying-bg/text-dying   bg-clean-bg/text-clean
Links      text-link underline underline-offset-2
Shell      mx-auto max-w-5xl px-6
Radius     rounded-sm (the only one)
Shadows    none
```

Prompt to paste when adding a page:

> Build this using only the tokens in DESIGN.md. Surfaces are `paper` and
> `paper-raised`, text is `ink` / `ink-secondary` / `ink-muted`, every border is
> `rule`. Red, amber and green are reserved for dead, dying and clean status and
> every status chip carries a text label. Headings inherit Newsreader
> automatically. Wrap the page in `mx-auto max-w-5xl px-6`. No shadows, no
> gradients, no animation, no hardcoded colors. Verify it in both themes.

Before opening a PR that touches UI:

```sh
grep -rE "(bg|text|border)-(white|black|gray|slate|zinc|neutral|stone|red|amber|green|blue)-[0-9]" app/
grep -rE "#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?\b" app/
```

Both should return nothing.
