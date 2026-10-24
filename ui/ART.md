# Agent Courtroom art guide

Read this before you touch anything visual. Every screen in `ui/` follows it, so the dashboard, the courtroom and the case log look like one game.

## North star

**A tiny, adorable courthouse for robots.** Picture a pastel pixel-art visual novel: chibi lawyers with huge sparkly eyes argue over a worker who got stuck in a loop. It should make a judge at the demo smile within two seconds, and then the numbers on the screen should be just as easy to read as the jokes.

Two rules hold everything together:

1. **Cute in the art, calm in the data.** Characters, the courtroom and the big moments (OBJECTION!, the verdict stamp) carry all the personality. Numbers, tables and labels stay plain, aligned and readable. The data is never decorated.
2. **One loud moment at a time.** Per screen, only one thing animates for attention: the speaking character, a burst, or the stamp. Everything else sits still.

## The pixel grid

- **1 art pixel = 4 CSS pixels** in UI chrome (borders, shadows, icons). Every border, gap and offset is a multiple of 4px.
- Canvas art is drawn at native size and scaled up by **whole numbers only**, with `image-rendering: pixelated`. Never scale by 1.5x, never smooth.
  - Courtroom scene: **256 × 144** (16:9).
  - Portrait: **48 × 48**.
  - Chibi sprite: **20 × 26** cell (16 × 22 body plus room for hair spikes and the outline).
- No anti-aliasing anywhere: no `border-radius`, no blur, no soft shadows, no smooth gradients. If you want a gradient, use two flat bands or a 2-colour dither.

## Palette

One light pastel theme. It's a demo on a projector, and pastel reads well and stands out from every dark dashboard in the room.

| Token | Hex | Use |
|---|---|---|
| `--ink` | `#2d1b3d` | Plum. All outlines, all text, hard shadows. Never pure black. |
| `--ink-soft` | `#6b5a7e` | Secondary text, idle lights, halted state. |
| `--paper` | `#fff7fb` | Panel and card fill. |
| `--blush` | `#ffe1ee` | Secondary fill: table stripes, inset areas, empty bar segments. |
| `--lilac` | `#c9bcff` | Page background (with a `#bfb0ff` 8px checker). |
| `--lilac-deep` | `#9d8cff` | Clerk colour, focus rings, links. |
| `--gold` | `#ffc93c` | **Judge.** Verdicts, the "watch" state, highlights. |
| `--berry` | `#ff5c8a` | **Prosecution.** "On trial", OBJECTION!, overspend. |
| `--sky` | `#4fb3ff` | **Defense.** HOLD IT!, tests passing on the defense side. |
| `--mint` | `#3ddc97` | **Worker.** Healthy state, tests passing bars. |
| `--wood` / `--wood-mid` / `--wood-dark` | `#f6b27a` / `#d9825a` / `#9c5236` | Benches, the bench, the witness stand. |

**Role colours are meaning, not decoration.** Gold always means the Judge or a verdict, berry always means prosecution or trouble, sky always means defense, mint always means a working, healthy worker. Don't use them for anything else.

Status mapping (dashboard, case log, badges):

| Status | Colour | Shown when |
|---|---|---|
| Working | mint | No open charge, or the court ruled `continue`. |
| On trial | berry | A charge is filed and court is in session. |
| New plan | gold | Ruling `change_strategy`. |
| Needs a human | lilac-deep | Ruling `escalate`. |
| Halted | ink-soft | Ruling `halt`. |

## Type

- **Pixelify Sans** (600/700): headings, names, buttons, the verdict stamp. Chunky and friendly.
- **DotGothic16**: body text, dialogue, numbers, tables. It's the JRPG text box font, and its digits are even width, so numbers line up.
- Scale (px): **12 · 16 · 20 · 28 · 40**. Body is 16, dialogue is 20, page titles are 28, the stamp and bursts are 40+.
- Sentence case everywhere. Character names in the name tag are the only all-caps text (it's a visual-novel convention).
- No monospace, no system fonts, no third typeface.

## Shapes and surfaces

Use the shared classes in `app/globals.css`. Don't hand-roll borders.

- `.px-box`: the standard panel. Paper fill, 4px ink border, square corners, a hard `4px 4px 0` ink shadow.
- `.px-inset`: a sunken area inside a panel (blush fill, no shadow).
- `.px-btn`: a pressable button. It sits on a 4px ink shadow and drops onto it when pressed.
- `.px-tag`: a small coloured label (status badges, the dialogue name tag).
- Meters are **segmented**: 12 or 20 square cells with a 4px gap, never a smooth bar. Tests passing uses one cell per test.
- Warning lights are 4 square pixel lamps (looping, stuck, overspend, flailing). Off is a hollow ink square, on is a filled role colour with a 4px "glow" ring in the same colour at 40%.

## Characters

Every character is drawn in code (`lib/sprites.ts`) from one shared chibi template so they match. Proportions: 2 heads tall, the head is wider than the body, and the eyes take up a third of the face. Every sprite gets a generated **1px `--ink` outline**. Never hand-draw outlines, so they stay consistent.

| Role | Name | Hair | Eyes | Signature |
|---|---|---|---|---|
| Judge | Judge Haku | long silver | gold | gold monocle, gavel |
| Prosecution | Prosecutor Aka | spiky strawberry red | orange | white cravat, points a lot |
| Defense | Defense Aoi | blue with an ahoge (one stray strand) | sky | gold badge, papers |
| Worker | worker-NN | mint bob | amber | antenna with a gold tip, headphones |
| Clerk | Clerk | (no sprite) | | a lilac speaker icon in the portrait slot |

Eyes always have **two white highlight pixels** (top-left big, bottom-right small) and every face has **blush** pixels. That's most of the cuteness. Expressions (`mood`): `neutral`, `happy`, `shout`, `angry`, `worried`, `dizzy` (swirl eyes, for a looping worker).

## The courtroom scene

Layout at 256 × 144: the Judge's bench is top centre. The prosecution desk (left), the witness stand with the worker (centre) and the defense desk (right) sit in one row in front of it. Everything important stays above y = 104, because on wide screens the dialogue box covers the floor, visual-novel style. Draw order, back to front: wall, Judge, bench and gavel, lawyers and worker, desks and stand. Pastel lilac wall, pink sakura windows, a gold scales-of-justice emblem, a pink and lilac checker floor.

- Whoever is speaking bobs by 1 pixel and gets a small gold arrow over their head.
- A looping worker has a little orbiting dot swirl over their head.

## Motion

- **All animation uses `steps()` timing**, never ease curves, so it moves like a sprite (8–12 frames per second).
- Big moments, each used once per beat:
  - **OBJECTION!** (berry) when the prosecution speaks, **HOLD IT!** (sky) when the defense speaks: a jagged burst plus a 4-pixel screen shake.
  - **The verdict stamp**: the ruling slams onto the screen with a slight rotation.
- Dialogue types out 2 characters per frame. Click, Space or Enter finishes the line, and a second press goes to the next one.
- `prefers-reduced-motion`: no shake, no bob, no typing (full lines appear at once), bursts and stamps just appear.

## Voice

The characters are dramatic and cute. The interface is not.

- Dialogue comes from the court's real arguments. Don't rewrite them. The clerk's opening line and the worker's two short lines (its plea and its reaction to the verdict, in `lib/script.ts`) are the only lines the UI writes.
- UI copy is plain, sentence case and specific: "Watch the trial", "Tests passing", "$0.31 of $1.00". No exclamation marks outside the courtroom.
- Events are always called "event 14", matching the court's text.

## Don'ts

- No rounded corners, blur, soft drop shadows, or smooth gradients.
- No emoji in the UI. If you need an icon, draw it as pixels on an 8 × 8 or 16 × 16 grid.
- No dark mode. One pastel theme.
- No new colours. If something needs a colour, it's either a role colour (with its meaning) or ink.
- No decoration on data: tables and meters stay flat and aligned.
