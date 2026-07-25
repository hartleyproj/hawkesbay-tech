// Daily researcher for hawkesbay.tech.
// For each sector, asks Claude (with web search) for the single most significant NEW
// development, written as a full article + Hawke's Bay analysis, and merges it into
// src/data.json. Conservative by design: on any error or invalid output for a sector,
// it leaves that sector unchanged. It NEVER writes malformed data.
//
// Env: ANTHROPIC_API_KEY (required), MODEL (optional), SEARCH_TOOL (optional).
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || '.');
const DATA_PATH = path.join(root, 'src/data.json');
const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.MODEL || 'claude-sonnet-4-5';
const SEARCH_TOOL = process.env.SEARCH_TOOL || 'web_search_20250305';
const MAX_PER_SECTOR = 12;

if (!API_KEY) { console.error('ANTHROPIC_API_KEY not set'); process.exit(1); }

const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));

// Today's date, formatted like the site ("25 Jul 2026"), in NZ time.
const nzNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Pacific/Auckland' }));
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const todayStr = `${String(nzNow.getDate()).padStart(2,'0')} ${MONTHS[nzNow.getMonth()]} ${nzNow.getFullYear()}`;

const sectorBrief = {
  ai: 'artificial intelligence — models, adoption, policy, chips, skills, NZ AI companies',
  solar: 'solar and renewable energy — solar farms, batteries, grid, agrivoltaics, energy policy',
  conn: 'connectivity — satellite internet, mobile, rural broadband, Starlink, spectrum',
  cloud: 'cloud and data — hyperscalers, data centres, AWS/Microsoft/Google, storage, power demand',
  space: 'space and aerospace — Rocket Lab, launches, satellites, NZ space sector',
  agri: 'agritech — robotics, AI and biotech in farming, horticulture, viticulture, dairy, food production',
  bay: 'tech and innovation happening inside the Hawke\'s Bay region itself (Napier, Hastings, Havelock North, Wairoa)'
};

function prompt(sector) {
  const existing = (data.sectors.find(s => s.id === sector.id)?.stories || [])
    .slice(0, 6).map(s => `- ${s.headline}`).join('\n');
  return `You are the editor of hawkesbay.tech, a New Zealand regional tech-news site that scans NZ (and globally significant) tech developments and translates each into what it means for Hawke's Bay's growth.

TASK: For the sector "${sector.name}" (${sectorBrief[sector.id]}), use web search to find the SINGLE most significant genuinely-NEW development from roughly the last 3 days (today is ${todayStr}). New Zealand focus, plus major global tech with clear NZ relevance. It must be real and verifiable with at least one linkable source you actually found.

We have already covered these recent stories in this sector — do NOT repeat them, pick something new:
${existing || '(none yet)'}

If there is a genuinely new, notable, well-sourced story, respond with ONLY a JSON object (no markdown, no prose around it) in exactly this shape:
{
  "headline": "punchy, specific headline",
  "brief": "<p>One tight paragraph (2-3 sentences) summarising the news, using <b>bold</b> for key figures. HTML allowed.</p>",
  "body": ["First full paragraph of the article.", "Second paragraph.", "Third paragraph.", "Optional fourth paragraph."],
  "lens": "One paragraph: what this specifically means for Hawke's Bay's tech growth (jobs, investment, adoption, resilience, primary-sector application). No HTML tags needed.",
  "sources": [{"l": "Publication name", "u": "https://real-url-you-found"}]
}

Rules: 3-4 body paragraphs, factual, grounded ONLY in what your search found — never invent figures, quotes or sources. Every source URL must be a real page you retrieved. If you did not find a genuinely new, notable story, respond with exactly the word NONE and nothing else.`;
}

async function callClaude(sector) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      tools: [{ type: SEARCH_TOOL, name: 'web_search', max_uses: 6 }],
      messages: [{ role: 'user', content: prompt(sector) }],
    }),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  const text = (json.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  return text;
}

function extractStory(text) {
  if (!text || /^NONE\b/i.test(text.trim())) return null;
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b < 0) return null;
  let obj;
  try { obj = JSON.parse(text.slice(a, b + 1)); } catch { return null; }
  // Strict validation — reject anything malformed so we never publish garbage.
  if (!obj || typeof obj.headline !== 'string' || obj.headline.length < 8) return null;
  if (typeof obj.brief !== 'string' || obj.brief.length < 20) return null;
  if (!Array.isArray(obj.body) || obj.body.length < 3 || obj.body.some(p => typeof p !== 'string' || p.length < 30)) return null;
  if (typeof obj.lens !== 'string' || obj.lens.length < 40) return null;
  if (!Array.isArray(obj.sources) || !obj.sources.length) return null;
  const sources = obj.sources.filter(s => s && typeof s.l === 'string' && typeof s.u === 'string' && /^https?:\/\//.test(s.u));
  if (!sources.length) return null;
  return {
    date: todayStr,
    headline: obj.headline.trim(),
    brief: obj.brief.trim(),
    body: obj.body.map(p => p.trim()),
    lens: obj.lens.trim(),
    sources,
  };
}

let changed = 0;
for (const sector of data.sectors) {
  try {
    const text = await callClaude(sector);
    const story = extractStory(text);
    if (!story) { console.log(`[${sector.id}] no new story`); continue; }
    const dupe = sector.stories.some(s => s.headline.toLowerCase() === story.headline.toLowerCase());
    if (dupe) { console.log(`[${sector.id}] duplicate, skipping`); continue; }
    sector.stories.unshift(story);
    if (sector.stories.length > MAX_PER_SECTOR) sector.stories.length = MAX_PER_SECTOR;
    changed++;
    console.log(`[${sector.id}] + "${story.headline}"`);
  } catch (e) {
    console.log(`[${sector.id}] error (left unchanged): ${e.message}`);
  }
}

if (changed > 0) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
  console.log(`Updated ${changed} sector(s).`);
} else {
  console.log('No changes today.');
}
