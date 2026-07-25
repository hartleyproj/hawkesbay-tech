// Builds public/index.html by injecting src/data.json into src/template.html.
// Deterministic: the template holds all layout/CSS/JS; data.json holds only story data.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || '.');
const tpl = fs.readFileSync(path.join(root, 'src/template.html'), 'utf8');
const data = JSON.parse(fs.readFileSync(path.join(root, 'src/data.json'), 'utf8'));

// Basic validation so we never build a broken site.
if (!data.lead || !Array.isArray(data.sectors) || !data.sectors.length) {
  throw new Error('data.json is missing lead or sectors');
}
for (const s of data.sectors) {
  if (!s.id || !s.name || !Array.isArray(s.stories) || !s.stories.length) {
    throw new Error('sector malformed: ' + JSON.stringify(s.id));
  }
  for (const st of s.stories) {
    if (!st.headline || !st.date || !st.brief || !Array.isArray(st.sources) || !st.sources.length) {
      throw new Error('story malformed in ' + s.id + ': ' + JSON.stringify(st.headline));
    }
  }
}

const inject = [
  `const LEAD = ${JSON.stringify(data.lead)};`,
  `const SECTORS = ${JSON.stringify(data.sectors)};`,
  `const STATS = ${JSON.stringify(data.stats || [])};`,
  `const RADAR = ${JSON.stringify(data.radar || [])};`,
].join('\n');

// Function replacer avoids '$' being treated as a special replacement pattern.
const out = tpl.replace('//__DATA__', () => inject);
if (out.indexOf('//__DATA__') !== -1 || out === tpl) {
  throw new Error('data marker //__DATA__ not found in template');
}

fs.mkdirSync(path.join(root, 'public'), { recursive: true });
fs.writeFileSync(path.join(root, 'public/index.html'), out);
console.log('built public/index.html', out.length, 'bytes, sectors:',
  data.sectors.map(s => `${s.id}:${s.stories.length}`).join(', '));
