// Generates an animated SVG of the last year of GitHub contributions
// as a little solar system: one planet per active month (size ∝ √contributions),
// a UFO with an alien cruising through, a starfield, and the odd shooting
// star or satellite passing in the background.
//
// Usage:
//   GITHUB_TOKEN=... node scripts/space.mjs <login> <outdir> [--lang <code>]
//   node scripts/space.mjs <login> <outdir> --from-file contrib.json [--static]
//
// Writes <outdir>/space.svg and <outdir>/space-dark.svg

import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const [login, outdir, ...flags] = process.argv.slice(2);
if (!login || !outdir) {
  console.error("usage: space.mjs <login> <outdir> [--from-file f] [--static] [--lang <code>]");
  process.exit(1);
}
const staticMode = flags.includes("--static");
const fileFlag = flags.indexOf("--from-file");

// caption + month labels. Without --lang the SVG follows each visitor's browser
// language (SVG <switch systemLanguage>) and falls back to English; --lang pins one.
// Browsers only match systemLanguage tags exactly (es-AR doesn't match "es"),
// so each language lists its regional variants. Add yours here.
const LOCALES = {
  en: {
    tags: [],
    months: ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"],
    caption: (t) => `${t} contributions in the last year · one planet per month`,
  },
  es: {
    tags: ["es", "es-419", "es-AR", "es-BO", "es-CL", "es-CO", "es-CR", "es-CU", "es-DO", "es-EC", "es-ES", "es-GT", "es-HN", "es-MX", "es-NI", "es-PA", "es-PE", "es-PR", "es-PY", "es-SV", "es-US", "es-UY", "es-VE"],
    months: ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"],
    caption: (t) => `${t} contribuciones en el último año · un planeta por mes`,
  },
  pt: {
    tags: ["pt", "pt-BR", "pt-PT", "pt-AO", "pt-MZ"],
    months: ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"],
    caption: (t) => `${t} contribuições no último ano · um planeta por mês`,
  },
  fr: {
    tags: ["fr", "fr-FR", "fr-CA", "fr-BE", "fr-CH", "fr-LU"],
    months: ["janv", "févr", "mars", "avr", "mai", "juin", "juil", "août", "sept", "oct", "nov", "déc"],
    caption: (t) => `${t} contributions sur la dernière année · une planète par mois`,
  },
  it: {
    tags: ["it", "it-IT", "it-CH"],
    months: ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"],
    caption: (t) => `${t} contributi nell'ultimo anno · un pianeta al mese`,
  },
  de: {
    tags: ["de", "de-DE", "de-AT", "de-CH"],
    months: ["jan", "feb", "mär", "apr", "mai", "jun", "jul", "aug", "sep", "okt", "nov", "dez"],
    caption: (t) => `${t} Beiträge im letzten Jahr · ein Planet pro Monat`,
  },
  zh: {
    tags: ["zh", "zh-CN", "zh-TW", "zh-HK", "zh-SG", "zh-Hans", "zh-Hant", "zh-Hans-CN", "zh-Hant-TW", "zh-Hant-HK"],
    months: ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"],
    caption: (t) => `过去一年 ${t} 次贡献 · 每月一颗星球`,
  },
  ja: {
    tags: ["ja", "ja-JP"],
    months: ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"],
    caption: (t) => `過去1年間のコントリビューション ${t} 件 · 1か月に1つの惑星`,
  },
};
const langFlag = flags.indexOf("--lang");
const lang = langFlag !== -1 ? flags[langFlag + 1] : null; // null = follow the visitor
if (lang !== null && !LOCALES[lang]) {
  console.error(`unknown --lang "${lang}" (available: ${Object.keys(LOCALES).join(", ")})`);
  process.exit(1);
}

// one <text>, or a <switch> with a <text> per language when following the visitor.
// A <switch> picks the first child whose language is anywhere in the visitor's list,
// so English (most people's second language) goes last, as the fallback.
function say(attrs, fn) {
  if (lang) return `<text ${attrs}>${esc(fn(LOCALES[lang]))}</text>`;
  const others = Object.values(LOCALES).filter((L) => L.tags.length);
  return `<switch>${others
    .map((L) => `<text systemLanguage="${L.tags.join(", ")}" ${attrs}>${esc(fn(L))}</text>`)
    .join("")}<text ${attrs}>${esc(fn(LOCALES.en))}</text></switch>`;
}

async function fetchCalendar() {
  if (fileFlag !== -1) {
    return JSON.parse(readFileSync(flags[fileFlag + 1], "utf8"));
  }
  const query = `query($login:String!){ user(login:$login){ contributionsCollection {
    contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } } } } }`;
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${process.env.GITHUB_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables: { login } }),
  });
  if (!res.ok) throw new Error(`GraphQL ${res.status}: ${await res.text()}`);
  return res.json();
}

function aggregate(data) {
  const cal = data.data.user.contributionsCollection.contributionCalendar;
  const byMonth = new Map();
  for (const w of cal.weeks)
    for (const d of w.contributionDays) {
      const key = d.date.slice(0, 7);
      byMonth.set(key, (byMonth.get(key) ?? 0) + d.contributionCount);
    }
  const months = [...byMonth.entries()]
    .filter(([, total]) => total > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, total]) => ({ key, total }));
  return { months, grandTotal: cal.totalContributions };
}

// deterministic PRNG so the starfield doesn't shuffle on every regeneration
function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

const PLANET_COLORS = [
  { body: "#e58f6a", shade: "#c9714f", light: "#f4c4ab" }, // coral
  { body: "#7fb8a4", shade: "#5f9a86", light: "#b8e0d0" }, // teal
  { body: "#a99ae0", shade: "#8a7ac4", light: "#cfc6f0" }, // lavender
  { body: "#e0b354", shade: "#c39638", light: "#f0d9a0" }, // gold
  { body: "#88b5d8", shade: "#6a97bb", light: "#c0dcef" }, // ice blue
  { body: "#d789a8", shade: "#b96b8b", light: "#ecc0d2" }, // rose
];

// each calendar month has a fixed look, so a planet never changes style or color
// as totals grow or months slide out of the window. [style, PLANET_COLORS index]
// Neighbouring months never share a style; the three repeats sit far apart.
const MONTH_LOOK = [
  ["moon", 3],    // jan
  ["belt", 4],    // feb
  ["spiral", 5],  // mar
  ["icecap", 0],  // apr
  ["craters", 1], // may
  ["moon", 2],    // jun
  ["storm", 3],   // jul
  ["ring", 4],    // aug
  ["belt", 5],    // sep
  ["spiral", 0],  // oct
  ["stripes", 1], // nov
  ["halo", 2],    // dec
];

function render({ months, grandTotal }, palette) {
  const W = 840;
  const H = 300;
  const p = palette;
  const rand = mulberry32(20260815);
  const parts = [];

  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" rx="12" fill="${p.bg}"/>`);

  // starfield: mostly still, a few twinkling
  for (let i = 0; i < 60; i++) {
    const x = (8 + rand() * (W - 16)).toFixed(1);
    const y = (8 + rand() * (H - 40)).toFixed(1);
    const r = (0.7 + rand() * 1.1).toFixed(2);
    const tw = i % 4 === 0;
    const delay = (rand() * 3).toFixed(2);
    parts.push(
      tw
        ? `<circle class="tw" style="animation-delay:${delay}s" cx="${x}" cy="${y}" r="${r}" fill="${p.star}"/>`
        : `<circle cx="${x}" cy="${y}" r="${r}" fill="${p.star}" opacity="${(0.35 + rand() * 0.4).toFixed(2)}"/>`
    );
  }

  // rare visitors: a shooting star and a satellite.
  // An SVG on GitHub can't run JS, so "random" means several precomputed passes per
  // CSS cycle, each with its own path and gap, seeded by the total so they change
  // whenever contributions do. Paint order can't change mid-animation, so the
  // satellite is drawn twice: once behind the planets and once in front, each
  // copy flying only its own passes.
  const satellite = (cls) => `
  <g class="${cls}">
    <g transform="rotate(-20)">
      <rect x="-13" y="-3" width="8" height="6" fill="${p.dome}" opacity="0.85"/>
      <rect x="5" y="-3" width="8" height="6" fill="${p.dome}" opacity="0.85"/>
      <line x1="-9" y1="-3" x2="-9" y2="3" stroke="${p.bg}" stroke-width="0.8" opacity="0.6"/>
      <line x1="9" y1="-3" x2="9" y2="3" stroke="${p.bg}" stroke-width="0.8" opacity="0.6"/>
      <rect x="-3.5" y="-4" width="7" height="8" rx="1.2" fill="${p.ufoTop}"/>
      <circle class="tw" cx="0" cy="-6" r="1.2" fill="${p.light2}"/>
    </g>
  </g>`;
  parts.push(`
  <defs><linearGradient id="tail" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="66" y2="-23"><stop offset="0" stop-color="${p.star}"/><stop offset="1" stop-color="${p.star}" stop-opacity="0"/></linearGradient></defs>
  <g class="meteor">
    <line x1="0" y1="0" x2="66" y2="-23" stroke="url(#tail)" stroke-width="1.8" stroke-linecap="round"/>
    <circle r="1.7" fill="${p.star}"/>
  </g>${satellite("sat")}`);

  // planets: one per active month, chronological left → right
  const n = months.length;
  const sqrts = months.map((m) => Math.sqrt(m.total));
  const sMin = Math.min(...sqrts);
  const sMax = Math.max(...sqrts);
  const R_MIN = 11;
  const R_MAX = 40;
  const radiusOf = (m) =>
    sMax === sMin
      ? (R_MIN + R_MAX) / 2
      : R_MIN + ((Math.sqrt(m.total) - sMin) / (sMax - sMin)) * (R_MAX - R_MIN);


  months.forEach((m, i) => {
    const r = radiusOf(m);
    const cx = 110 + ((W - 220) * (n === 1 ? 0.5 : i / (n - 1)));
    const cy = 128 + (i % 2 === 0 ? -26 : 26); // stagger orbits
    const [style, colorIdx] = MONTH_LOOK[Number(m.key.slice(5)) - 1];
    const c = PLANET_COLORS[colorIdx];
    const delay = (0.2 + i * 0.25).toFixed(2);
    const drift = (3.5 + (i % 3)).toFixed(1);

    // per-month PRNG (only for the belt's dot scatter): keyed by the month, not the total
    const pr = mulberry32(Number(m.key.replace("-", "")));
    const under = [];  // drawn behind the planet body (orbits, halos, belt back)
    const details = [];
    // crescent shading
    details.push(`<path d="M ${-r * 0.2} ${-r} a ${r} ${r} 0 0 1 0 ${2 * r} a ${r * 1.25} ${r * 1.25} 0 0 0 0 ${-2 * r}" fill="${c.shade}" opacity="0.55" transform="translate(${r * 0.2} 0)"/>`);

    if (style === "ring") {
      details.push(`<ellipse cx="0" cy="0" rx="${(r * 1.55).toFixed(1)}" ry="${(r * 0.38).toFixed(1)}" fill="none" stroke="${p.ring}" stroke-width="5" transform="rotate(-14)" opacity="0.9"/>`);
    } else if (style === "craters") {
      details.push(`<circle cx="${(-r * 0.35).toFixed(1)}" cy="${(-r * 0.25).toFixed(1)}" r="${(r * 0.18).toFixed(1)}" fill="${c.shade}" opacity="0.7"/>`);
      details.push(`<circle cx="${(r * 0.15).toFixed(1)}" cy="${(r * 0.4).toFixed(1)}" r="${(r * 0.12).toFixed(1)}" fill="${c.shade}" opacity="0.7"/>`);
    } else if (style === "stripes") {
      // gas giant bands, clipped to the disc
      details.push(`<clipPath id="clip${i}"><circle r="${r.toFixed(1)}"/></clipPath><g clip-path="url(#clip${i})"><g transform="rotate(-8)" fill="${c.shade}" opacity="0.5"><rect x="${-r.toFixed(1)}" y="${(-r * 0.48).toFixed(1)}" width="${(2 * r).toFixed(1)}" height="${(r * 0.24).toFixed(1)}" rx="${(r * 0.1).toFixed(1)}"/><rect x="${-r.toFixed(1)}" y="${(-r * 0.06).toFixed(1)}" width="${(2 * r).toFixed(1)}" height="${(r * 0.2).toFixed(1)}" rx="${(r * 0.09).toFixed(1)}"/><rect x="${-r.toFixed(1)}" y="${(r * 0.32).toFixed(1)}" width="${(2 * r).toFixed(1)}" height="${(r * 0.16).toFixed(1)}" rx="${(r * 0.08).toFixed(1)}"/></g></g>`);
    } else if (style === "storm") {
      // great-spot storm: soft rim + dark core
      details.push(`<ellipse cx="${(-r * 0.26).toFixed(1)}" cy="${(r * 0.2).toFixed(1)}" rx="${(r * 0.4).toFixed(1)}" ry="${(r * 0.25).toFixed(1)}" fill="${c.shade}" opacity="0.45"/>`);
      details.push(`<ellipse cx="${(-r * 0.26).toFixed(1)}" cy="${(r * 0.2).toFixed(1)}" rx="${(r * 0.27).toFixed(1)}" ry="${(r * 0.16).toFixed(1)}" fill="${c.shade}" opacity="0.95"/>`);
    } else if (style === "spiral") {
      // swirling vortex: an Archimedean spiral, slightly squashed to sit on the sphere
      const pts = [];
      for (let k = 0; k <= 72; k++) {
        const t = k / 72;
        const a = t * 2.5 * 2 * Math.PI;
        pts.push(`${(r * 0.82 * t * Math.cos(a)).toFixed(1)},${(r * 0.66 * t * Math.sin(a)).toFixed(1)}`);
      }
      details.push(`<polyline points="${pts.join(" ")}" fill="none" stroke="${c.shade}" stroke-width="${(r * 0.11).toFixed(1)}" stroke-linecap="round" opacity="0.65" transform="rotate(-14)"/>`);
    } else if (style === "icecap") {
      details.push(`<clipPath id="clip${i}"><circle r="${r.toFixed(1)}"/></clipPath><g clip-path="url(#clip${i})"><ellipse cy="${(-r * 0.74).toFixed(1)}" rx="${(r * 0.66).toFixed(1)}" ry="${(r * 0.3).toFixed(1)}" fill="#eef4fb" opacity="0.9" transform="rotate(-10)"/></g>`);
    } else if (style === "moon") {
      // dashed orbit behind, little moon in front (reuses the UFO greys, so it follows the theme)
      under.push(`<ellipse rx="${(r * 1.5).toFixed(1)}" ry="${(r * 0.46).toFixed(1)}" fill="none" stroke="${p.muted}" stroke-width="1.2" stroke-dasharray="3 5" opacity="0.35" transform="rotate(-18)"/>`);
      details.push(`<g transform="rotate(-18) translate(${(r * 1.5).toFixed(1)} 0) rotate(18)"><circle r="${(r * 0.26).toFixed(1)}" fill="${p.ufoTop}"/><circle cx="${(-r * 0.08).toFixed(1)}" cy="${(-r * 0.06).toFixed(1)}" r="${(r * 0.07).toFixed(1)}" fill="${p.ufoBody}" opacity="0.8"/></g>`);
      // a second, smaller moon on the far side of the same orbit
      details.push(`<g transform="rotate(-18) translate(${(-r * 1.41).toFixed(1)} ${(-r * 0.16).toFixed(1)})"><circle r="${(r * 0.16).toFixed(1)}" fill="${p.ufoBody}"/></g>`);
    } else if (style === "halo") {
      under.push(`<circle r="${(r * 1.2).toFixed(1)}" fill="none" stroke="${c.light}" stroke-width="${(r * 0.13).toFixed(1)}" opacity="0.5"/>`);
      under.push(`<circle r="${(r * 1.38).toFixed(1)}" fill="none" stroke="${c.light}" stroke-width="${(r * 0.1).toFixed(1)}" opacity="0.22"/>`);
    } else if (style === "belt") {
      // asteroid belt: same tilt as the ring, back dots behind the disc, front dots over it
      const back = [];
      const front = [];
      for (let k = 0; k < 22; k++) {
        const th = (k / 22) * 2 * Math.PI + pr() * 0.3;
        const y = r * 0.42 * Math.sin(th);
        const dot = `<circle cx="${(r * 1.62 * Math.cos(th)).toFixed(1)}" cy="${y.toFixed(1)}" r="${(r * (0.057 + pr() * 0.057)).toFixed(1)}" fill="${p.ring}" opacity="${(0.5 + pr() * 0.45).toFixed(2)}"/>`;
        (y <= 0 ? back : front).push(dot);
      }
      under.push(`<g transform="rotate(-14)">${back.join("")}</g>`);
      details.push(`<g transform="rotate(-14)">${front.join("")}</g>`);
    }

    const labelPad = style === "ring" ? 30 : style === "belt" ? 26 : 22;
    parts.push(`
  <g transform="translate(${cx.toFixed(1)} ${cy})">
    <g class="pop" style="animation-delay:${delay}s">
      <g class="drift" style="animation-duration:${drift}s">
        ${under.join("\n        ")}
        <circle r="${r.toFixed(1)}" fill="${c.body}"/>
        ${details.join("\n        ")}
      </g>
    </g>
    ${say(`class="fade lbl" style="animation-delay:${(Number(delay) + 0.4).toFixed(2)}s" y="${(r + labelPad).toFixed(0)}" text-anchor="middle" fill="${p.muted}"`, (L) => `${L.months[Number(m.key.slice(5)) - 1]} · ${m.total}`)}
  </g>`);
  });

  // the satellite's front copy: over the planets, under the UFO
  parts.push(satellite("satf"));

  // UFO with alien, cruising across on loop
  parts.push(`
  <g class="cruise">
    <g class="bob">
      <ellipse cx="0" cy="6" rx="30" ry="9" fill="${p.ufoBody}"/>
      <ellipse cx="0" cy="2" rx="30" ry="8" fill="${p.ufoTop}"/>
      <path d="M -14 -2 a 14 12 0 0 1 28 0 z" fill="${p.dome}" opacity="0.65"/>
      <circle cx="0" cy="-6" r="6" fill="#8fd48a"/>
      <circle cx="-2.2" cy="-7" r="1.4" fill="#1d3320"/>
      <circle cx="2.2" cy="-7" r="1.4" fill="#1d3320"/>
      <circle class="lt" cx="-18" cy="7" r="2" fill="${p.light1}"/>
      <circle class="lt" style="animation-delay:-0.8s" cx="0" cy="9" r="2" fill="${p.light2}"/>
      <circle class="lt" style="animation-delay:-1.6s" cx="18" cy="7" r="2" fill="${p.light1}"/>
    </g>
  </g>`);

  // caption
  parts.push(`
  ${say(`class="fade cap" style="animation-delay:1.8s" x="${W / 2}" y="${H - 16}" text-anchor="middle" fill="${p.muted}"`, (L) => L.caption(grandTotal))}`);

  // keyframes for one element doing several passes per cycle; between passes it's
  // invisible, so jumping to the next start point never shows.
  // passes: [{ t0, t1, from: [x, y], to: [x, y], rot }] in seconds; fade in/out in seconds
  function flyby(name, passes, total, fade) {
    const pct = (t) => `${((t / total) * 100).toFixed(3)}%`;
    const tf = ([x, y], rot) => `translate(${x.toFixed(0)}px,${y.toFixed(0)}px)${rot === undefined ? "" : ` rotate(${rot.toFixed(0)}deg)`}`;
    const f = [`0%{transform:${tf(passes[0].from, passes[0].rot)};opacity:0}`];
    for (const q of passes) {
      f.push(`${pct(q.t0)}{transform:${tf(q.from, q.rot)};opacity:0}`);
      f.push(`${pct(q.t0 + fade)}{opacity:1}`);
      f.push(`${pct(q.t1 - fade)}{opacity:1}`);
      f.push(`${pct(q.t1)}{transform:${tf(q.to, q.rot)};opacity:0}`);
    }
    const last = passes[passes.length - 1];
    f.push(`100%{transform:${tf(last.to, last.rot)};opacity:0}`);
    return `@keyframes ${name}{${f.join("")}}`;
  }

  const vr = mulberry32(grandTotal * 7919 + 3);
  const between = (a, b) => a + vr() * (b - a);

  // shooting star: 4 passes, the first one soon after load, then 30–60s apart.
  // Direction alternates; rightward streaks start in the left half and leftward ones
  // in the right half, each in its own quarter, so no two passes look alike.
  // The tail points along (66,-23), i.e. the streak moves at 161°; rot turns it.
  const zonesFor = { right: [0, 1].sort(() => vr() - 0.5), left: [2, 3].sort(() => vr() - 0.5) };
  const rightFirst = vr() < 0.5;
  const meteorPasses = [];
  let t = 4;
  for (let k = 0; k < 4; k++) {
    const goRight = (k % 2 === 0) === rightFirst;
    const deg = goRight ? between(15, 50) : between(130, 165); // down-right / down-left
    const a = (deg * Math.PI) / 180;
    const len = between(170, 260);
    const zone = zonesFor[goRight ? "right" : "left"].pop();
    const from = [120 + (zone + vr()) * ((W - 240) / 4), between(14, 100)];
    const dur = between(0.9, 1.4);
    meteorPasses.push({ t0: t, t1: t + dur, from, to: [from[0] + len * Math.cos(a), from[1] + len * Math.sin(a)], rot: deg - 161 });
    t += dur + between(30, 60);
  }
  const meteorTotal = t;

  // satellite: 3 diagonal crossings edge to edge, 35–70s apart. Side alternates
  // every pass and climb/descent every two, so all three cross differently.
  const ltrFirst = vr() < 0.5;
  const climbFirst = vr() < 0.5;
  const satPasses = [];
  t = 12;
  for (let k = 0; k < 3; k++) {
    const ltr = (k % 2 === 0) === ltrFirst;
    const climb = (k < 2) === climbFirst;
    const low = between(150, 250);
    const high = between(30, 110);
    const [y0, y1] = climb ? [low, high] : [high, low];
    const dur = between(10, 15);
    satPasses.push({ t0: t, t1: t + dur, from: [ltr ? -30 : W + 30, y0], to: [ltr ? W + 30 : -30, y1] });
    t += dur + between(35, 70);
  }
  const satTotal = t;
  // one of the three crossings goes in front of the planets, the rest behind
  const frontIdx = Math.floor(vr() * satPasses.length);
  const satBehind = satPasses.filter((_, k) => k !== frontIdx);
  const satFront = [satPasses[frontIdx]];

  const css = staticMode
    ? `.cruise{transform:translate(420px,52px)}.meteor,.sat,.satf{display:none}`
    : `
    .pop{animation:pop .5s cubic-bezier(.3,1.6,.5,1) both}
    .fade{animation:fadein .6s ease-out both}
    .drift{animation:drift 4s ease-in-out infinite alternate}
    .tw{animation:tw 2.8s ease-in-out infinite}
    .cruise{animation:cruise 20s linear infinite}
    .lt{animation:lights 2.4s linear infinite}
    @keyframes lights{0%,100%{fill:#ffd166}25%{fill:#ef8368}50%{fill:#8fd48a}75%{fill:#88b5d8}}
    .bob{animation:bob 1.6s ease-in-out infinite alternate}
    @keyframes pop{from{transform:scale(0)}to{transform:scale(1)}}
    @keyframes fadein{from{opacity:0}to{opacity:1}}
    @keyframes drift{from{transform:translateY(-3px)}to{transform:translateY(3px)}}
    @keyframes tw{0%,100%{opacity:.15}50%{opacity:.9}}
    @keyframes cruise{from{transform:translate(-60px,52px)}to{transform:translate(${W + 60}px,52px)}}
    @keyframes bob{from{transform:translateY(-2.5px)}to{transform:translateY(2.5px)}}
    .meteor{animation:meteor ${meteorTotal.toFixed(1)}s linear infinite both}
    .sat{animation:sat ${satTotal.toFixed(1)}s linear infinite both}
    .satf{animation:satf ${satTotal.toFixed(1)}s linear infinite both}
    ${flyby("meteor", meteorPasses, meteorTotal, 0.25)}
    ${flyby("sat", satBehind, satTotal, 0.3)}
    ${flyby("satf", satFront, satTotal, 0.3)}
    @media (prefers-reduced-motion:reduce){
      .pop,.fade,.drift,.tw,.bob,.lt{animation:none}
      .cruise{animation:none;transform:translate(420px,52px)}
      .meteor,.sat,.satf{animation:none;display:none}
    }`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <style>
    text{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
    .lbl{font-size:12px}
    .cap{font-size:13px}
    ${css}
  </style>
${parts.join("\n")}
</svg>\n`;
}

// space is dark in both themes; the variants only tune how the frame sits on the page
const LIGHT = {
  bg: "#1c2340", star: "#e8ecf5", muted: "#9aa5c4", ring: "#e8d5a0",
  ufoBody: "#aab4c8", ufoTop: "#cdd6e4", dome: "#bfe3f5", light1: "#ffd166", light2: "#ef8368",
};
const DARK = {
  bg: "#0d1117", star: "#dfe6f2", muted: "#8b949e", ring: "#d9c68f",
  ufoBody: "#8b95a7", ufoTop: "#b7c1d1", dome: "#a8d8ef", light1: "#ffd166", light2: "#ef8368",
};

const data = aggregate(await fetchCalendar());
mkdirSync(outdir, { recursive: true });
writeFileSync(join(outdir, "space.svg"), render(data, LIGHT));
writeFileSync(join(outdir, "space-dark.svg"), render(data, DARK));
console.log(`ok: ${data.months.length} planets, ${data.grandTotal} contributions`);
