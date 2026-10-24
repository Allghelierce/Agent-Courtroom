// All pixel art is drawn here from code, so every character shares one template (ART.md, "Characters").
// Shapes go into a Pix buffer first; outline() then adds the 1px ink edge to every silhouette.

export const INK = "#2d1b3d";
const WHITE = "#ffffff";
const BLUSH = "#ff9ab8";
const MOUTH = "#9c3a5c";
const TONGUE = "#ff8fae";
const GOLD = "#ffc93c";
const GOLD_D = "#c98a1a";
const SWEAT = "#8fd3ff";

export type CastKey = "judge" | "pros" | "def" | "worker" | "clerk";
export type Mood = "neutral" | "happy" | "shout" | "angry" | "worried" | "dizzy";

type Look = {
  name: string;
  tag: string; // name-tag colour (the role colour)
  hair: string;
  hairD: string;
  hairL: string;
  eye: string;
  skin: string;
  skinD: string;
  outfit: string;
  outfitD: string;
  trim: string;
  style: "long" | "spiky" | "ahoge" | "bob";
};

export const CAST: Record<Exclude<CastKey, "clerk">, Look> & { clerk: { name: string; tag: string } } = {
  judge: { name: "JUDGE HAKU", tag: "#ffc93c", hair: "#eef0fa", hairD: "#a9b0c8", hairL: WHITE, eye: "#ffb321", skin: "#ffe2cc", skinD: "#f2b49a", outfit: "#4a3566", outfitD: "#33244a", trim: GOLD, style: "long" },
  pros: { name: "PROSECUTOR AKA", tag: "#ff5c8a", hair: "#ff5a6e", hairD: "#c22f4b", hairL: "#ff9aa6", eye: "#ff8a3d", skin: "#ffe6d2", skinD: "#f2b49a", outfit: "#e0365e", outfitD: "#a8203f", trim: WHITE, style: "spiky" },
  def: { name: "DEFENSE AOI", tag: "#4fb3ff", hair: "#4a86ff", hairD: "#2a52b8", hairL: "#9cc4ff", eye: "#36a9ff", skin: "#ffe6d2", skinD: "#f2b49a", outfit: "#3550a0", outfitD: "#233670", trim: GOLD, style: "ahoge" },
  worker: { name: "WORKER", tag: "#3ddc97", hair: "#5ff0b8", hairD: "#25a87c", hairL: "#b4ffe0", eye: "#ffaa33", skin: "#f6f2ff", skinD: "#d4cbef", outfit: "#7a68b8", outfitD: "#56468e", trim: "#5ff0b8", style: "bob" },
  clerk: { name: "CLERK", tag: "#9d8cff" },
};

// ---------- pixel buffer ----------

export class Pix {
  readonly data: (string | null)[];
  constructor(readonly w: number, readonly h: number) {
    this.data = new Array(w * h).fill(null);
  }
  set(x: number, y: number, c: string) {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.data[y * this.w + x] = c;
  }
  get(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.data[y * this.w + x] : null;
  }
  rect(x: number, y: number, w: number, h: number, c: string) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }
  // Isoceles spike, pointing up (or down).
  spike(x: number, y: number, w: number, h: number, c: string, up = true) {
    for (let r = 0; r < h; r++) {
      const ww = Math.max(1, Math.round(w * (up ? (r + 1) / h : (h - r) / h)));
      this.rect(x + Math.floor((w - ww) / 2), y + r, ww, 1, c);
    }
  }
  // 1px outline around every filled shape (4-neighbour), drawn into empty pixels only.
  outline(c = INK) {
    const edge: number[] = [];
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++)
        if (!this.get(x, y) && (this.get(x - 1, y) || this.get(x + 1, y) || this.get(x, y - 1) || this.get(x, y + 1))) edge.push(y * this.w + x);
    for (const i of edge) this.data[i] = c;
    return this;
  }
  draw(ctx: CanvasRenderingContext2D, dx = 0, dy = 0) {
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const c = this.data[y * this.w + x];
        if (c) {
          ctx.fillStyle = c;
          ctx.fillRect(dx + x, dy + y, 1, 1);
        }
      }
  }
  toCanvas(): HTMLCanvasElement {
    const cv = document.createElement("canvas");
    cv.width = this.w;
    cv.height = this.h;
    this.draw(cv.getContext("2d")!);
    return cv;
  }
}

// ---------- chibi (scene sprite) ----------

export const CHIBI_W = 22;
export const CHIBI_H = 30;
const OX = 3; // template origin inside the cell, leaving room for spikes, antenna and outline
const OY = 5;

function chibiEyes(p: Pix, look: Look, mood: Mood, ox: number, oy: number) {
  const at = (x: number, y: number, w: number, h: number, c: string) => p.rect(ox + x, oy + y, w, h, c);
  for (const ex of [4, 9]) {
    if (mood === "happy") {
      at(ex, 9, 1, 1, INK); at(ex + 1, 8, 1, 1, INK); at(ex + 2, 9, 1, 1, INK);
    } else if (mood === "dizzy") {
      at(ex, 7, 3, 4, INK); at(ex + 1, 8, 1, 2, WHITE); at(ex + 1, 9, 2, 1, WHITE);
    } else {
      const h = mood === "shout" ? 5 : 4;
      const y = mood === "shout" ? 6 : 7;
      at(ex, y, 3, h, INK);
      at(ex, y + h - 2, 3, 2, look.eye);
      at(ex, y, 1, 1, WHITE);
      at(ex + 2, y + h - 2, 1, 1, WHITE);
    }
  }
  if (mood === "angry") { at(4, 6, 2, 1, INK); at(6, 7, 1, 1, INK); at(10, 6, 2, 1, INK); at(9, 7, 1, 1, INK); }
  if (mood === "worried") { at(4, 6, 1, 1, INK); at(5, 5, 2, 1, INK); at(11, 6, 1, 1, INK); at(9, 5, 2, 1, INK); at(14, 6, 1, 2, SWEAT); }
}

function chibiMouth(p: Pix, mood: Mood, ox: number, oy: number) {
  const at = (x: number, y: number, w: number, h: number, c: string) => p.rect(ox + x, oy + y, w, h, c);
  if (mood === "shout" || mood === "angry") { at(6, 11, 4, 2, MOUTH); at(7, 12, 2, 1, TONGUE); }
  else if (mood === "happy") { at(6, 11, 1, 1, MOUTH); at(7, 12, 2, 1, MOUTH); at(9, 11, 1, 1, MOUTH); }
  else if (mood === "dizzy" || mood === "worried") { at(7, 12, 2, 1, MOUTH); }
  else at(7, 12, 2, 1, MOUTH);
}

export function chibi(who: Exclude<CastKey, "clerk">, mood: Mood = "neutral"): Pix {
  const look = CAST[who];
  const p = new Pix(CHIBI_W, CHIBI_H);
  const at = (x: number, y: number, w: number, h: number, c: string) => p.rect(OX + x, OY + y, w, h, c);

  // back hair
  if (look.style === "long") at(1, 4, 14, 14, look.hairD);
  if (look.style === "bob") at(1, 4, 14, 9, look.hairD);

  // body: small, the head does the talking
  at(4, 15, 8, 6, look.outfit);
  at(4, 15, 8, 1, look.outfitD);
  at(7, 15, 2, 3, look.trim);
  at(3, 16, 1, 4, look.outfit); at(12, 16, 1, 4, look.outfit);
  at(3, 20, 1, 1, look.skin); at(12, 20, 1, 1, look.skin);
  at(5, 21, 2, 1, look.outfitD); at(9, 21, 2, 1, look.outfitD);
  if (who === "pros") at(6, 15, 4, 2, WHITE);
  if (who === "def") at(10, 17, 1, 1, GOLD);

  // head
  at(2, 3, 12, 11, look.skin);
  at(3, 13, 10, 1, look.skinD);

  // hair cap and bangs
  at(1, 1, 14, 4, look.hair);
  at(2, 0, 12, 1, look.hair);
  at(2, 5, 2, 3, look.hair); at(12, 5, 2, 3, look.hair);
  at(5, 5, 3, 2, look.hair); at(9, 5, 2, 1, look.hair);
  at(4, 1, 4, 1, look.hairL);
  if (look.style === "long") { at(1, 5, 1, 12, look.hair); at(14, 5, 1, 12, look.hair); }
  if (look.style === "spiky") { p.spike(OX - 1, OY - 3, 4, 4, look.hair); p.spike(OX + 5, OY - 4, 5, 5, look.hair); p.spike(OX + 12, OY - 3, 4, 4, look.hair); }
  if (look.style === "ahoge") { at(8, -3, 1, 3, look.hair); at(9, -4, 2, 1, look.hair); }
  if (look.style === "bob") {
    at(7, -3, 1, 3, "#a9b0c8"); at(6, -4, 3, 1, GOLD); // antenna
    at(0, 6, 2, 4, GOLD); at(14, 6, 2, 4, GOLD); // headphones
  }

  chibiEyes(p, look, mood, OX, OY);
  at(3, 11, 2, 1, BLUSH); at(11, 11, 2, 1, BLUSH);
  chibiMouth(p, mood, OX, OY);
  if (who === "judge") { at(8, 6, 5, 1, GOLD_D); at(13, 7, 1, 5, GOLD); } // monocle rim and chain

  return p.outline();
}

// ---------- portrait (dialogue bust) ----------

export const BUST = 48;

export function portrait(who: CastKey, mood: Mood = "neutral"): Pix {
  const bg = new Pix(BUST, BUST);
  bg.rect(0, 0, BUST, BUST, "#ffe1ee");
  for (let y = 0; y < BUST; y += 4) for (let x = (y / 4) % 2 === 0 ? 0 : 4; x < BUST; x += 8) bg.rect(x, y, 4, 4, "#ffd2e5");

  if (who === "clerk") {
    // a little lilac speaker icon: the clerk has no face
    const icon = new Pix(BUST, BUST);
    icon.rect(13, 18, 8, 12, "#9d8cff");
    icon.rect(21, 13, 4, 22, "#9d8cff");
    icon.rect(25, 9, 3, 30, "#9d8cff");
    icon.rect(31, 18, 2, 12, "#6b5a7e"); icon.rect(35, 14, 2, 20, "#6b5a7e");
    icon.outline();
    return compose(bg, icon);
  }

  const look = CAST[who];
  const c = new Pix(BUST, BUST);
  const R = (x: number, y: number, w: number, h: number, col: string) => c.rect(x, y, w, h, col);

  if (look.style === "long") R(6, 10, 36, 38, look.hairD);
  if (look.style === "bob") R(7, 10, 34, 24, look.hairD);
  // shoulders
  R(5, 39, 38, 9, look.outfit); R(5, 39, 38, 2, look.outfitD);
  R(19, 37, 10, 11, look.trim); R(22, 39, 4, 9, look.outfitD);
  if (who === "pros") { R(18, 37, 12, 5, WHITE); R(22, 42, 4, 4, WHITE); }
  if (who === "def") { R(33, 42, 4, 4, GOLD); R(34, 43, 2, 2, GOLD_D); }
  if (who === "worker") { R(33, 42, 3, 3, look.trim); }
  // neck and face
  R(20, 33, 8, 6, look.skinD);
  R(11, 10, 26, 24, look.skin); R(13, 34, 22, 1, look.skinD);
  // hair cap and bangs
  R(9, 4, 30, 9, look.hair); R(11, 2, 26, 2, look.hair);
  R(9, 13, 4, 10, look.hair); R(35, 13, 4, 10, look.hair);
  c.spike(13, 12, 6, 6, look.hair, false); c.spike(19, 12, 6, 8, look.hair, false); c.spike(26, 12, 6, 6, look.hair, false); c.spike(31, 12, 5, 5, look.hair, false);
  R(14, 5, 10, 2, look.hairL);
  if (look.style === "spiky") { c.spike(5, 0, 8, 8, look.hair); c.spike(15, 0, 8, 5, look.hair); c.spike(27, 0, 8, 5, look.hair); c.spike(36, 1, 8, 8, look.hair); }
  if (look.style === "ahoge") { R(25, 0, 2, 4, look.hair); R(27, 0, 4, 2, look.hair); }
  if (look.style === "long") { R(6, 13, 5, 32, look.hair); R(37, 13, 5, 32, look.hair); }
  if (look.style === "bob") {
    R(4, 16, 6, 9, GOLD); R(38, 16, 6, 9, GOLD); R(5, 17, 4, 7, GOLD_D); R(39, 17, 4, 7, GOLD_D);
    R(23, 0, 2, 4, "#a9b0c8"); R(22, 0, 4, 1, GOLD);
  }

  // brows
  const browY = mood === "worried" ? 17 : 18;
  if (mood === "angry") { R(14, 18, 6, 1, look.hairD); R(19, 19, 2, 1, look.hairD); R(28, 18, 6, 1, look.hairD); R(27, 19, 2, 1, look.hairD); }
  else if (mood === "worried") { R(14, 19, 2, 1, look.hairD); R(16, 18, 5, 1, look.hairD); R(27, 18, 5, 1, look.hairD); R(32, 19, 2, 1, look.hairD); }
  else { R(14, browY, 7, 1, look.hairD); R(27, browY, 7, 1, look.hairD); }

  // eyes: big, two highlights each
  for (const ex of [14, 27]) {
    if (mood === "happy") {
      R(ex, 25, 2, 1, INK); R(ex + 1, 24, 2, 1, INK); R(ex + 3, 23, 1, 1, INK); R(ex + 4, 24, 2, 1, INK); R(ex + 5, 25, 2, 1, INK);
      continue;
    }
    if (mood === "dizzy") {
      R(ex, 21, 7, 8, INK); R(ex + 1, 22, 5, 6, WHITE); R(ex + 2, 23, 3, 4, INK); R(ex + 3, 24, 1, 2, WHITE);
      continue;
    }
    const top = mood === "shout" ? 20 : 21;
    R(ex, top, 7, 29 - top, INK);
    R(ex + 1, 24, 5, 4, look.eye);
    R(ex + 1, 27, 5, 1, WHITE);
    R(ex + 1, top + 1, 2, 2, WHITE);
    R(ex + 4, 25, 1, 1, WHITE);
    R(ex - 1, top, 1, 1, INK); R(ex + 7, top, 1, 1, INK);
  }
  if (mood === "worried" || mood === "dizzy") { R(38, 17, 2, 4, SWEAT); R(37, 19, 1, 2, SWEAT); }
  R(12, 30, 4, 2, BLUSH); R(32, 30, 4, 2, BLUSH);

  // mouth
  if (mood === "shout" || mood === "angry") { R(21, 30, 6, 3, MOUTH); R(22, 31, 4, 2, TONGUE); }
  else if (mood === "happy") { R(20, 30, 2, 1, MOUTH); R(22, 31, 4, 1, MOUTH); R(26, 30, 2, 1, MOUTH); }
  else if (mood === "worried" || mood === "dizzy") { R(21, 31, 2, 1, MOUTH); R(23, 30, 2, 1, MOUTH); R(25, 31, 2, 1, MOUTH); }
  else R(22, 31, 4, 1, MOUTH);

  if (who === "judge") { R(26, 20, 9, 1, GOLD_D); R(26, 29, 9, 1, GOLD_D); R(26, 20, 1, 10, GOLD_D); R(34, 20, 1, 10, GOLD_D); R(35, 29, 1, 12, GOLD); }

  c.outline();
  return compose(bg, c);
}

function compose(bottom: Pix, top: Pix): Pix {
  const out = new Pix(bottom.w, bottom.h);
  for (let i = 0; i < out.data.length; i++) out.data[i] = top.data[i] ?? bottom.data[i];
  return out;
}

// ---------- the courtroom (256 x 144) ----------

export const SCENE_W = 256;
export const SCENE_H = 144;
const FLOOR_Y = 82;

// Where each character stands (top-left of their chibi cell) and where their speech arrow floats.
export const STAGE: Record<Exclude<CastKey, "clerk">, { x: number; y: number }> = {
  judge: { x: 117, y: 20 },
  pros: { x: 30, y: 56 },
  def: { x: 204, y: 56 },
  worker: { x: 117, y: 56 },
};

export function sceneBack(): Pix {
  const p = new Pix(SCENE_W, SCENE_H);
  // wall: lilac with soft pink wallpaper stripes
  p.rect(0, 0, SCENE_W, FLOOR_Y, "#b9a8ff");
  for (let x = 0; x < SCENE_W; x += 16) p.rect(x, 8, 8, FLOOR_Y - 8, "#c4b5ff");
  for (let x = 4; x < SCENE_W; x += 16) for (let y = 16; y < FLOOR_Y - 8; y += 16) { p.rect(x, y, 1, 1, "#ffd2e5"); }
  p.rect(0, 0, SCENE_W, 6, "#8f7ae6");
  p.rect(0, 6, SCENE_W, 2, "#ffd2e5");
  // wainscot
  p.rect(0, FLOOR_Y - 14, SCENE_W, 14, "#d9825a");
  p.rect(0, FLOOR_Y - 14, SCENE_W, 2, "#f6b27a");
  for (let x = 6; x < SCENE_W; x += 20) p.rect(x, FLOOR_Y - 10, 14, 8, "#c4704a");

  // sakura windows
  for (const wx of [14, 210]) {
    p.rect(wx - 2, 14, 36, 44, INK);
    p.rect(wx, 16, 32, 40, "#ffd2e5");
    p.rect(wx, 16, 32, 14, "#ffe9f2");
    p.rect(wx, 44, 32, 12, "#ffb3d1");
    for (const [bx, by] of [[4, 34], [10, 30], [20, 36], [26, 32], [15, 40]]) p.rect(wx + bx, by, 3, 3, "#ff8fbf");
    p.rect(wx + 15, 16, 2, 40, INK);
    p.rect(wx, 35, 32, 2, INK);
    p.rect(wx - 4, 58, 40, 3, "#f6b27a");
  }

  // gold scales-of-justice emblem with a heart
  p.rect(114, 9, 28, 18, GOLD_D);
  p.rect(116, 11, 24, 14, GOLD);
  p.rect(127, 12, 2, 12, GOLD_D);
  p.rect(119, 14, 18, 1, GOLD_D);
  p.rect(118, 15, 1, 3, GOLD_D); p.rect(137, 15, 1, 3, GOLD_D);
  p.rect(116, 18, 5, 1, GOLD_D); p.rect(135, 18, 5, 1, GOLD_D);
  p.rect(125, 22, 6, 2, GOLD_D);
  p.rect(126, 10, 1, 1, "#ff5c8a"); p.rect(129, 10, 1, 1, "#ff5c8a"); p.rect(126, 11, 4, 1, "#ff5c8a"); p.rect(127, 12, 2, 1, "#ff5c8a");

  // floor: pink and lilac checker
  p.rect(0, FLOOR_Y, SCENE_W, SCENE_H - FLOOR_Y, "#ffc8de");
  for (let y = FLOOR_Y; y < SCENE_H; y += 8) for (let x = ((y - FLOOR_Y) / 8) % 2 === 0 ? 0 : 16; x < SCENE_W; x += 32) p.rect(x, y, 16, 8, "#e3d6ff");
  p.rect(0, FLOOR_Y, SCENE_W, 1, INK);
  // red carpet up the middle
  p.rect(104, FLOOR_Y + 1, 48, SCENE_H - FLOOR_Y, "#ff7aa0");
  p.rect(104, FLOOR_Y + 1, 2, SCENE_H - FLOOR_Y, GOLD); p.rect(150, FLOOR_Y + 1, 2, SCENE_H - FLOOR_Y, GOLD);
  return p;
}

// The Judge's bench: in front of the Judge, behind everyone else.
export function sceneBench(): Pix {
  const p = new Pix(SCENE_W, SCENE_H);
  p.rect(84, 46, 88, 4, "#f6b27a");
  p.rect(86, 50, 84, 28, "#9c5236");
  for (const bx of [90, 118, 146]) { p.rect(bx, 54, 20, 20, "#d9825a"); p.rect(bx, 54, 20, 1, "#f6b27a"); }
  p.rect(116, 47, 24, 3, GOLD);
  p.rect(124, 58, 8, 8, GOLD); p.rect(126, 60, 4, 4, GOLD_D);
  return p.outline();
}

// The desks and the witness stand, in front of the lawyers and the worker.
export function sceneFront(): Pix {
  const p = new Pix(SCENE_W, SCENE_H);
  // prosecution and defense desks
  for (const dx of [10, 184]) {
    p.rect(dx, 82, 62, 4, "#f6b27a");
    p.rect(dx + 2, 86, 58, 22, "#d9825a");
    p.rect(dx + 2, 86, 58, 1, "#9c5236");
    p.rect(dx + 6, 90, 50, 14, "#c4704a");
  }
  p.rect(18, 79, 10, 3, WHITE); p.rect(19, 77, 8, 2, "#ffe1ee"); // papers
  p.rect(232, 79, 10, 3, WHITE); p.rect(233, 77, 8, 2, "#ffe1ee");
  // name plates
  p.rect(30, 94, 22, 6, "#ff5c8a"); p.rect(204, 94, 22, 6, "#4fb3ff");
  // witness stand
  p.rect(106, 82, 44, 4, "#f6b27a");
  p.rect(108, 86, 40, 18, "#9c5236");
  p.rect(112, 90, 32, 10, "#d9825a");
  p.rect(117, 92, 22, 6, "#3ddc97");
  return p.outline();
}

// The gavel, raised or down, drawn on the bench.
export function gavel(up: boolean): Pix {
  const p = new Pix(14, 12);
  p.rect(1, 10, 12, 2, "#9c5236");
  if (up) { p.rect(5, 1, 7, 4, "#d9825a"); p.rect(2, 3, 4, 1, "#f6b27a"); }
  else { p.rect(5, 5, 7, 4, "#d9825a"); p.rect(1, 7, 5, 1, "#f6b27a"); }
  return p.outline();
}
