# Agent Courtroom art guide

Read this before you touch anything visual, so the dashboard, the courtroom and the case log look like one game.

## How the UI fits together

**The courtroom is the face. The numbers prove it works.**

- **The courtroom leads.** The dashboard opens on the courtroom scene: the live trial while court is in session, otherwise the latest intervention. Then the impact numbers (saved vs. unsupervised, interventions, cost of oversight), the with/without comparison, the monitor rules, the workers, the interventions table and the activity log.
- **Pixel chrome, readable data.** Every surface is pixel art: 4px borders, hard shadows, Pixelify headings, pixel buttons and tags. But text, numbers and tables are IBM Plex Sans with tabular figures, so the data reads like a real tool, not a game menu.
- **The courtroom's own text stays in-world.** The dialogue box and the evidence pinned in the scene use DotGothic16 (the `.vn` class); cut-ins and the stamp use Pixelify.
- **One plain view.** Each case also has a **Record** tab: the same case as an audit (charge, ruling, instruction sent, outcome, arguments, the evidence table, the verdict JSON). It lives inside `.console` and uses flat hairline `.card`s, `.btn`s, `.chip`s and `table.data`, for anyone checking the work. It's the only place without pixel chrome.
- **Role colours are shared.** Gold, red, blue, green and amber mean the same thing everywhere, so a ruling chip in the Record matches the stamp in the courtroom.
- Charges decided without a trial (summary judgment: repeat offender, court over budget) get a short ruling card instead of the full courtroom.

## North star

**A tiny night-time courthouse for robots.** Picture an anime pixel-art visual novel at night: chibi lawyers with huge sparkly eyes argue over a worker who got stuck in a loop, in a dark purple courtroom lit by gold. It should make a judge at the demo smile within two seconds, and then the numbers on the screen should be just as easy to read as the jokes. Cute, not girly: the cuteness comes from the characters, while the room and the interface stay dark, bold and game-like.

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

One dark theme: the palette of the original anime-pixel mockup. Tokens live in `app/globals.css`.

| Token | Hex | Use |
|---|---|---|
| `--bg` | `#0b0814` | Page background: an 8px `#120d21` checker, hard 2px scanlines and sparse `--edge` pixel stars. Static. |
| `--panel` | `#1b1430` | Panel and card fill. |
| `--inset` | `#120c22` | Sunken areas, empty meter cells, ghost buttons. |
| `--edge` | `#3b2f57` | Panel borders and pixel outlines in the UI. |
| `--shadow` | `#000000` | Hard drop shadows. |
| `--text` | `#f6eedd` | Body text. |
| `--soft` | `#b9aed0` | Secondary text, idle lights, the clerk, the halted state. |
| `--on-accent` | `#120c22` | Text on any bright fill (tags, buttons, stamps). |
| `--gold` | `#f7c948` | **Judge.** Verdicts, the "new plan" state, primary buttons, the title. |
| `--red` | `#ff5d73` | **Prosecution.** "On trial", OBJECTION!, overspending. |
| `--blue` | `#5cc8ff` | **Defense.** HOLD IT!. |
| `--green` | `#7af0c4` | **Worker.** Healthy state, tests passing. |
| `--amber` | `#ffb347` | Needs a human; spend meters. |

Scene colours (canvas only): wall `#2a1d4a` with `#3a2a63` pillars, wood `#c98a4a` / `#8f5530` / `#6e3f22`, plum checker floor `#4a2c3e` / `#5a3650`, carpet `#7a2348`, sakura windows `#ffb7d5`, sprite outlines `#120c22`.

**Role colours are meaning, not decoration.** Gold always means the Judge or a verdict, red always means prosecution or trouble, blue always means defense, green always means a working, healthy worker. Don't use them for anything else.

Status mapping (dashboard, case log, badges):

| Status | Colour | Shown when |
|---|---|---|
| Working | green | No open charge, or the court ruled `continue`. |
| On trial | red | A charge is filed and court is in session. |
| New plan | gold | Ruling `change_strategy`. |
| Needs a human | amber | Ruling `escalate`. |
| Halted | soft | Ruling `halt`. |

## Type

- **Pixelify Sans** (500/700): headings, worker names, buttons, tags, the verdict stamp. Chunky and friendly.
- **IBM Plex Sans** (400/500/600): body text, labels, numbers and tables, with tabular figures so numbers line up. This is what makes the data look trustworthy.
- **DotGothic16**: the courtroom's dialogue box and in-scene evidence only (`.vn`). It's the JRPG text-box font.
- Scale (px): **12 · 13 · 15 · 20 · 28 · 32 · 40**. Body is 15, small labels 13, dialogue 20, page titles 28, headline numbers 32, the stamp and bursts 40+.
- Sentence case everywhere. Character names in the dialogue name tag are the only all-caps text (it's a visual-novel convention).
- No monospace, and no typeface beyond these three.

## Shapes and surfaces

Use the shared classes in `app/globals.css`. Don't hand-roll borders.

- `.px-box`: the standard panel. Panel fill, 4px edge border, square corners, a hard `4px 4px 0` black shadow.
- `.px-inset`: a sunken area inside a panel (inset fill, no shadow).
- `.px-btn`: a pressable button. It sits on a 4px shadow and drops onto it when pressed. Gold is primary, `.red` is the "watch the trial" call to action, `.ghost` is secondary.
- `.px-tag`: a small coloured label (status badges, the dialogue name tag).
- `.px-table`: data tables inside a `.px-box` (interventions). Pixel rules between rows, plain Plex cells.
- Meters are **segmented**: 12 or 20 square cells with a 4px gap, never a smooth bar. Tests passing uses one cell per test.
- Warning lights are 4 square pixel lamps (looping, stuck, overspend, flailing). Off is a hollow edge-coloured square, on is a filled role colour with a 4px "glow" ring in the same colour at 40%.

## Characters

Every character is drawn in code (`lib/sprites.ts`) from one shared chibi template so they match. Proportions: 2 heads tall, the head is wider than the body, and the eyes take up a third of the face. Every sprite gets a generated **1px `#120c22` outline**. Never hand-draw outlines, so they stay consistent.

| Role | Name | Hair | Eyes | Signature |
|---|---|---|---|---|
| Judge | Judge Haku | long silver | gold | gold monocle, gavel |
| Prosecution | Prosecutor Aka | spiky strawberry red | orange | white cravat, points a lot |
| Defense | Defense Aoi | blue with an ahoge (one stray strand) | sky | gold badge, papers |
| Worker | worker-NN | mint bob | amber | antenna with a gold tip, headphones |
| Clerk | Clerk | (no sprite) | | a soft-grey speaker icon in the portrait slot |

Eyes always have **two white highlight pixels** (top-left big, bottom-right small) and every face has **blush** pixels. That's most of the cuteness. Expressions (`mood`): `neutral`, `happy`, `shout`, `angry`, `worried`, `dizzy` (swirl eyes, for a looping worker).

## The courtroom scene

Layout at 256 × 144: the Judge's bench is top centre. The prosecution desk (left), the witness stand with the worker (centre) and the defense desk (right) sit in one row in front of it. Everything important stays above y = 104, because on wide screens the dialogue box covers the floor, visual-novel style. Draw order, back to front: wall, Judge, bench and gavel, lawyers and worker, desks and stand. Dark purple wall with pillars, sakura windows, a gold scales-of-justice emblem, a plum checker floor and a red carpet.

- Whoever is speaking bobs by 1 pixel and gets a small gold arrow over their head.
- A looping worker has a little orbiting dot swirl over their head.

## Motion

- **All animation uses `steps()` timing**, never ease curves, so it moves like a sprite (8–12 frames per second).
- Big moments, each used once per beat:
  - **OBJECTION!** (red) when the prosecution speaks, **HOLD IT!** (blue) when the defense speaks: a jagged burst plus a 4-pixel screen shake.
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
- No light mode, and no pastel or pink UI. One dark theme; pink lives only in the sakura windows and petals.
- No new colours. If something needs a colour, it's either a role colour (with its meaning) or a neutral token.
- No decoration on data: tables and meters stay flat and aligned.
