// Generates an animated SVG of the last year of GitHub contributions
// as a little solar system: one planet per active month (size ∝ √contributions),
// a UFO with an alien cruising through, and a starfield.
//
// Usage:
//   GITHUB_TOKEN=... node scripts/space.mjs <login> <outdir>
//   node scripts/space.mjs <login> <outdir> --from-file contrib.json [--static]
//
// Writes <outdir>/space.svg and <outdir>/space-dark.svg

import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const [login, outdir, ...flags] = process.argv.slice(2);
if (!login || !outdir) {
  console.error("usage: space.mjs <login> <outdir> [--from-file f] [--static]");
  process.exit(1);
}
const staticMode = flags.includes("--static");
const fileFlag = flags.indexOf("--from-file");

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

const MONTHS_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

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
    .map(([key, total]) => ({ key, total, label: MONTHS_ES[Number(key.slice(5)) - 1] }));
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
  { body: "#e58f6a", shade: "#c9714f" }, // coral
  { body: "#7fb8a4", shade: "#5f9a86" }, // teal
  { body: "#a99ae0", shade: "#8a7ac4" }, // lavender
  { body: "#e0b354", shade: "#c39638" }, // gold
  { body: "#88b5d8", shade: "#6a97bb" }, // ice blue
  { body: "#d789a8", shade: "#b96b8b" }, // rose
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

  const biggest = months.reduce((a, b) => (b.total > a.total ? b : a));

  months.forEach((m, i) => {
    const r = radiusOf(m);
    const cx = 110 + ((W - 220) * (n === 1 ? 0.5 : i / (n - 1)));
    const cy = 128 + (i % 2 === 0 ? -26 : 26); // stagger orbits
    const c = PLANET_COLORS[i % PLANET_COLORS.length];
    const delay = (0.2 + i * 0.25).toFixed(2);
    const drift = (3.5 + (i % 3)).toFixed(1);

    const details = [];
    // crescent shading
    details.push(`<path d="M ${-r * 0.2} ${-r} a ${r} ${r} 0 0 1 0 ${2 * r} a ${r * 1.25} ${r * 1.25} 0 0 0 0 ${-2 * r}" fill="${c.shade}" opacity="0.55" transform="translate(${r * 0.2} 0)"/>`);
    if (m === biggest) {
      // ring for the biggest month
      details.push(`<ellipse cx="0" cy="0" rx="${(r * 1.55).toFixed(1)}" ry="${(r * 0.38).toFixed(1)}" fill="none" stroke="${p.ring}" stroke-width="5" transform="rotate(-14)" opacity="0.9"/>`);
    } else if (r > 16) {
      // a couple of craters on mid-size planets
      details.push(`<circle cx="${(-r * 0.35).toFixed(1)}" cy="${(-r * 0.25).toFixed(1)}" r="${(r * 0.18).toFixed(1)}" fill="${c.shade}" opacity="0.7"/>`);
      details.push(`<circle cx="${(r * 0.15).toFixed(1)}" cy="${(r * 0.4).toFixed(1)}" r="${(r * 0.12).toFixed(1)}" fill="${c.shade}" opacity="0.7"/>`);
    }

    parts.push(`
  <g transform="translate(${cx.toFixed(1)} ${cy})">
    <g class="pop" style="animation-delay:${delay}s">
      <g class="drift" style="animation-duration:${drift}s">
        <circle r="${r.toFixed(1)}" fill="${c.body}"/>
        ${details.join("\n        ")}
      </g>
    </g>
    <text class="fade lbl" style="animation-delay:${(Number(delay) + 0.4).toFixed(2)}s" y="${(r + (m === biggest ? 30 : 22)).toFixed(0)}" text-anchor="middle" fill="${p.muted}">${esc(m.label)} · ${m.total}</text>
  </g>`);
  });

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
      <circle cx="-18" cy="7" r="2" fill="${p.light1}"/>
      <circle cx="0" cy="9" r="2" fill="${p.light2}"/>
      <circle cx="18" cy="7" r="2" fill="${p.light1}"/>
    </g>
  </g>`);

  // caption
  parts.push(`
  <text class="fade cap" style="animation-delay:1.8s" x="${W / 2}" y="${H - 16}" text-anchor="middle" fill="${p.muted}">${grandTotal} contribuciones en el último año · un planeta por mes</text>`);

  const css = staticMode
    ? `.cruise{transform:translate(420px,52px)}`
    : `
    .pop{animation:pop .5s cubic-bezier(.3,1.6,.5,1) both}
    .fade{animation:fadein .6s ease-out both}
    .drift{animation:drift 4s ease-in-out infinite alternate}
    .tw{animation:tw 2.8s ease-in-out infinite}
    .cruise{animation:cruise 14s linear infinite}
    .bob{animation:bob 1.6s ease-in-out infinite alternate}
    @keyframes pop{from{transform:scale(0)}to{transform:scale(1)}}
    @keyframes fadein{from{opacity:0}to{opacity:1}}
    @keyframes drift{from{transform:translateY(-3px)}to{transform:translateY(3px)}}
    @keyframes tw{0%,100%{opacity:.15}50%{opacity:.9}}
    @keyframes cruise{from{transform:translate(-60px,52px)}to{transform:translate(${W + 60}px,52px)}}
    @keyframes bob{from{transform:translateY(-2.5px)}to{transform:translateY(2.5px)}}
    @media (prefers-reduced-motion:reduce){
      .pop,.fade,.drift,.tw,.bob{animation:none}
      .cruise{animation:none;transform:translate(420px,52px)}
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
