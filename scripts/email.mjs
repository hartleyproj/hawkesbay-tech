// Emails a short "what was added today" digest after the daily build/deploy.
// Sends via Resend. No-ops (exit 0) if RESEND_API_KEY is not set, so the job never fails for a missing key.
// Env: RESEND_API_KEY (required to send), EMAIL_TO (default tom@focusai.co.nz), EMAIL_FROM (default Resend onboarding sender).
import fs from 'node:fs';
import path from 'node:path';

const KEY = process.env.RESEND_API_KEY;
if (!KEY) { console.log('No RESEND_API_KEY set — skipping email.'); process.exit(0); }

const root = path.resolve(process.argv[2] || '.');
const TO = process.env.EMAIL_TO || 'tom@focusai.co.nz';
const FROM = process.env.EMAIL_FROM || 'hawkesbay.tech <onboarding@resend.dev>';

const data = JSON.parse(fs.readFileSync(path.join(root, 'src/data.json'), 'utf8'));

// Today's date in NZ, formatted like the site ("27 Jul 2026").
const nzNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Pacific/Auckland' }));
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const today = `${String(nzNow.getDate()).padStart(2,'0')} ${MONTHS[nzNow.getMonth()]} ${nzNow.getFullYear()}`;

const SECTOR = { ai:'AI', solar:'Solar & Energy', conn:'Connectivity', cloud:'Cloud & Data', space:'Space', agri:'Agritech', bay:'The Bay Scene' };

const strip = s => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

const leadNew = (data.lead && data.lead.date === today) ? data.lead : null;
const newStories = [];
for (const s of (data.sectors || [])) {
  for (const st of (s.stories || [])) {
    if (st.date === today) newStories.push({ sector: SECTOR[s.id] || s.name || s.id, headline: st.headline });
  }
}

const count = (leadNew ? 1 : 0) + newStories.length;
let html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1.5;color:#18222f">`;
html += `<h2 style="margin:0 0 10px">hawkesbay.tech — added today (${today})</h2>`;
if (leadNew) {
  html += `<p style="margin:0 0 6px"><b>LEAD:</b> ${leadNew.headline}</p>`;
  html += `<p style="margin:0 0 14px;color:#5f6a72">${strip(leadNew.brief).slice(0, 220)}…</p>`;
}
if (newStories.length) {
  html += `<ul style="margin:0 0 14px;padding-left:18px">` +
    newStories.map(n => `<li><b>${n.sector}</b> — ${n.headline}</li>`).join('') + `</ul>`;
}
if (!leadNew && !newStories.length) {
  html += `<p style="margin:0 0 14px">No new stories were added today. The site was refreshed and redeployed.</p>`;
}
html += `<p style="margin:0"><a href="https://hawkesbay.tech" style="color:#3c5f88;font-weight:600">Open hawkesbay.tech →</a></p></div>`;

const subject = count
  ? `hawkesbay.tech — ${count} update${count === 1 ? '' : 's'} for ${today}`
  : `hawkesbay.tech — refreshed for ${today} (no new stories)`;

try {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [TO], subject, html }),
  });
  const txt = await res.text();
  if (!res.ok) console.log(`Email send FAILED (${res.status}): ${txt.slice(0, 400)}`);
  else console.log(`Email sent to ${TO}: ${txt.slice(0, 200)}`);
} catch (e) {
  console.log(`Email error (not failing the job): ${e.message}`);
}
