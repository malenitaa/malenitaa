// Generates an animated SVG of the last year of GitHub contributions
// stacked as pancakes. One pancake per active month, width ∝ √contributions.
//
// Usage:
//   GITHUB_TOKEN=... node scripts/pancakes.mjs <login> <outdir>
//   node scripts/pancakes.mjs <login> <outdir> --from-file contrib.json [--static]
//
// Writes <outdir>/pancakes.svg and <outdir>/pancakes-dark.svg

import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const [login, outdir, ...flags] = process.argv.slice(2);
if (!login || !outdir) {
  console.error("usage: pancakes.mjs <login> <outdir> [--from-file f] [--static]");
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
    .map(([key, total]) => ({
      key,
      total,
      label: MONTHS_ES[Number(key.slice(5)) - 1],
    }));
  return { months, grandTotal: cal.totalContributions };
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

function render({ months, grandTotal }, palette) {
  // biggest pancake at the bottom, like a real stack
  const stack = [...months].sort((a, b) => b.total - a.total);
  const n = stack.length;

  const W = 840;
  const H = 300;
  const CX = 380;
  const PANCAKE_H = 26;
  const STEP = 21; // vertical distance between pancakes (they overlap a bit)
  const MIN_W = 84;
  const MAX_W = 280;

  const sqrts = stack.map((m) => Math.sqrt(m.total));
  const sMin = Math.min(...sqrts);
  const sMax = Math.max(...sqrts);
  const widthOf = (m) => {
    if (sMax === sMin) return (MIN_W + MAX_W) / 2;
    return MIN_W + ((Math.sqrt(m.total) - sMin) / (sMax - sMin)) * (MAX_W - MIN_W);
  };

  const plateY = 240;
  const p = palette;
  const parts = [];

  // plate
  parts.push(`
  <g class="fade" style="animation-delay:0s">
    <ellipse cx="${CX}" cy="${plateY + 10}" rx="180" ry="14" fill="${p.plate}"/>
    <ellipse cx="${CX}" cy="${plateY + 6}" rx="180" ry="14" fill="${p.plateTop}"/>
    <rect x="${CX - 40}" y="${plateY + 18}" width="80" height="8" rx="4" fill="${p.plate}"/>
  </g>`);

  const bodies = ["#e2a44c", "#d99a41"]; // alternate shades so the layers read
  let topY = plateY;
  stack.forEach((m, i) => {
    const w = widthOf(m);
    const y = plateY - i * STEP; // bottom of this pancake
    topY = y - PANCAKE_H;
    const delay = (0.25 + i * 0.32).toFixed(2);
    const labelDelay = (0.25 + i * 0.32 + 0.45).toFixed(2);
    parts.push(`
  <g transform="translate(${CX} ${y})">
    <g class="p" style="animation-delay:${delay}s">
      <rect x="${-w / 2}" y="${-PANCAKE_H}" width="${w.toFixed(1)}" height="${PANCAKE_H}" rx="13" fill="${bodies[i % 2]}"/>
      <rect x="${-w / 2 + 7}" y="${-PANCAKE_H + 3.5}" width="${(w - 14).toFixed(1)}" height="7" rx="3.5" fill="#f2c576" opacity="0.85"/>
    </g>
  </g>
  <text class="fade lbl" style="animation-delay:${labelDelay}s" x="${CX + MAX_W / 2 + 26}" y="${y - PANCAKE_H / 2 + 4}" fill="${p.muted}">${esc(m.label)} · ${m.total}</text>`);
  });

  const lastDelay = 0.25 + n * 0.32;

  // butter on the top pancake
  parts.push(`
  <g transform="translate(${CX} ${topY})">
    <g class="p" style="animation-delay:${lastDelay.toFixed(2)}s">
      <rect x="-14" y="-13" width="28" height="13" rx="2.5" fill="#f7d64b"/>
      <rect x="-14" y="-13" width="28" height="5" rx="2.5" fill="#fbe98d"/>
    </g>
  </g>`);

  // steam
  const steamDelay = (lastDelay + 0.5).toFixed(2);
  const steam = (dx, wob) => `
    <path class="steam" style="animation-delay:${steamDelay}s;--wob:${wob}" d="M${CX + dx} ${topY - 26} q -6 -10 0 -20 q 6 -10 0 -20" fill="none" stroke="${p.steam}" stroke-width="4" stroke-linecap="round"/>`;
  parts.push(steam(-34, "-4px"), steam(2, "4px"), steam(36, "-4px"));

  // caption
  parts.push(`
  <text class="fade cap" style="animation-delay:${(lastDelay + 0.4).toFixed(2)}s" x="${CX}" y="${plateY + 46}" text-anchor="middle" fill="${p.text}">${grandTotal} contribuciones en el último año, apiladas</text>`);

  const css = staticMode
    ? `.steam{opacity:.55}`
    : `
    .p{animation:fall .55s cubic-bezier(.28,1.5,.55,1) both}
    .fade{animation:fadein .5s ease-out both}
    .steam{opacity:0;animation:rise 2.6s ease-in-out infinite both}
    @keyframes fall{from{transform:translateY(-300px)}to{transform:translateY(0)}}
    @keyframes fadein{from{opacity:0}to{opacity:1}}
    @keyframes rise{0%{opacity:0;transform:translateY(6px)}35%{opacity:.55}100%{opacity:0;transform:translate(var(--wob),-12px)}}
    @media (prefers-reduced-motion:reduce){.p,.fade,.steam{animation:none}.steam{opacity:.55}}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <style>
    text{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
    .lbl{font-size:13px}
    .cap{font-size:14px}
    ${css}
  </style>
${parts.join("\n")}
</svg>\n`;
}

const LIGHT = { plate: "#c7cdd4", plateTop: "#eceff2", muted: "#8b949e", text: "#57606a", steam: "#b6bec7" };
const DARK = { plate: "#30363d", plateTop: "#484f58", muted: "#8b949e", text: "#9198a1", steam: "#6e7681" };

const data = aggregate(await fetchCalendar());
mkdirSync(outdir, { recursive: true });
writeFileSync(join(outdir, "pancakes.svg"), render(data, LIGHT));
writeFileSync(join(outdir, "pancakes-dark.svg"), render(data, DARK));
console.log(`ok: ${data.months.length} pancakes, ${data.grandTotal} contributions`);
