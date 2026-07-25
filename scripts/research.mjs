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
const MODEL = process.env.MODEL || 'claude-sonnet-5';
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
  return `You are the editor of hawkesbay.tech, a New Zealand regional tech-news site. For each sector you tell the WHOLE of one real story faithfully, then translate it into a clear-eyed vision for Hawke's Bay.

TASK: For the sector "${sector.name}" (${sectorBrief[sector.id]}), use web search to find the SINGLE most significant genuinely-NEW development from roughly the last 3 days (today is ${todayStr}). New Zealand focus, plus major global tech with clear NZ relevance. Then actually OPEN the article pages for that story and read them fully — you will write the story from those pages and nothing else.

We have already covered these recent stories in this sector — do NOT repeat them, pick something new:
${existing || '(none yet)'}

SOURCING RULES — accuracy matters far more than length. Read these carefully:
- The "brief" and "body" must be a faithful summary of ONLY the specific pages you actually opened and list in "sources". Those pages are your entire universe of facts — treat anything not in them as unknown.
- Every fact, figure, name, date and quote must appear in one of your listed sources. Copy figures EXACTLY as the source states them — never round, re-rank, recompute or restate a ratio (e.g. do not write "double" if the source's numbers make it triple). If a detail is unclear or you are unsure, leave it out.
- Do NOT add background, history, comparison, context or numbers from your own knowledge or from pages you are not citing. Do NOT attribute data to any organisation, report or dataset unless one of your cited pages explicitly attributes it that way.
- "sources" must be EXACTLY the pages you drew from: list every source you used, and never list a source you did not actually use in the text. Aim for 2-4 solid sources.
- COMPLETENESS: tell the whole story, not a thin slice. Include the substantive who/what/when/how-much/why-it-matters the sources contain — the key players, figures, timeline, stakes and any notable dissent or risk. Use as many paragraphs as that genuinely takes (usually 3-5). Never truncate the story to save space, and never pad with filler, repetition or generic background — every sentence must carry real substance drawn from the sources.
- Use clean text and plain straight quotes. No stray, garbled or non-English characters (te reo Māori macrons like ā, ē, ī, ō, ū are fine).

The "lens" is where you turn the story into a vision for Hawke's Bay. In one substantial paragraph, answer plainly: what does this mean for the region, what COULD the Bay do to capture the advantage, and what SHOULD it do — concrete moves for growers, businesses, councils, investors or workers. Be specific and honest: if the real answer is "little or nothing directly," say so and explain why, rather than forcing a connection. The lens is your analysis, but it must not smuggle in new factual claims dressed up as reporting.

BEFORE YOU ANSWER, critique your own draft against the sources: Is every fact and figure accurate and actually in a cited source? Have you told the whole story, or left out something important? Is every listed source used, and is nothing used that isn't listed? Is the Hawke's Bay vision substantive and honest? Fix every problem you find, then output only the corrected result.

If there is a genuinely new, notable, well-sourced story, respond with ONLY a JSON object (no markdown, no prose around it) in exactly this shape:
{
  "headline": "punchy, specific headline — supported by the sources",
  "brief": "<p>One tight paragraph (2-3 sentences) summarising the news, using <b>bold</b> for key figures that appear in the sources. HTML allowed.</p>",
  "body": ["First paragraph, faithful to the sources.", "Second paragraph.", "Third paragraph.", "More as needed to tell the whole story."],
  "lens": "One substantial paragraph: what this means for Hawke's Bay, and what the region could and should do (if anything) to capture the advantage. No HTML tags needed.",
  "sources": [{"l": "Publication name", "u": "https://real-url-you-actually-read"}]
}

If you did not find a genuinely new, notable story you can summarise faithfully from real sources, respond with exactly the word NONE and nothing else.`;
}

async function callAPI(userText) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 3000,
      tools: [{ type: SEARCH_TOOL, name: 'web_search', max_uses: 6 }],
      messages: [{ role: 'user', content: userText }],
    }),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  return (json.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
}

// Second pass: re-open the sources and fact-check the draft before it can be published.
// "Always critique before posting." Returns a corrected story, or null to reject it.
function critiquePrompt(sector, story) {
  return `You are a rigorous fact-checking editor for hawkesbay.tech. Below is a DRAFT story for the "${sector.name}" sector as JSON, with the sources it cites. Re-open EVERY source URL, read it, and correct the draft so it is fully accurate, complete and substantive.

Checklist:
- Every fact, figure, name, date and quote in "brief" and "body" must appear in one of the cited sources, stated EXACTLY — no rounding, re-ranking, recomputing or restated ratios. Fix or delete anything unsupported.
- The article must rely ONLY on the listed sources. Remove any source not actually used. If a claim relies on a page that isn't listed, either add that page (only if you verified it) or cut the claim.
- Completeness: if the sources hold important facts, players, figures or risks the draft leaves out, add them — tell the whole story. Do not pad with filler.
- The "lens" must be a substantive, honest Hawke's Bay vision: what it means, and what the region could and should do (or honestly little, with a reason). No new factual claims dressed as reporting.
- Clean text only; no stray or garbled characters.

Return ONLY the corrected JSON in exactly the same shape {headline, brief, body[], lens, sources[]}. If the story cannot be made accurate and well-sourced, return exactly the word NONE.

DRAFT:
${JSON.stringify({ headline: story.headline, brief: story.brief, body: story.body, lens: story.lens, sources: story.sources }, null, 2)}`;
}

async function critique(sector, story) {
  const text = await callAPI(critiquePrompt(sector, story));
  return extractStory(text);
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
  if (!Array.isArray(obj.body) || obj.body.length < 2 || obj.body.some(p => typeof p !== 'string' || p.length < 30)) return null;
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
    const draft = extractStory(await callAPI(prompt(sector)));
    if (!draft) { console.log(`[${sector.id}] no new story`); continue; }
    // Always critique before posting: re-verify against the sources.
    let story;
    try {
      story = await critique(sector, draft);
    } catch (e) {
      console.log(`[${sector.id}] critique failed, not publishing: ${e.message}`);
      continue;
    }
    if (!story) { console.log(`[${sector.id}] rejected by fact-check`); continue; }
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
