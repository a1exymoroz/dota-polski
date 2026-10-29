// Stamps ?v=<content hash> on style.css and app.js in index.html so iOS Safari never pairs new HTML with a cached old file.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const html = 'public/index.html';
const v = createHash('sha1').update(readFileSync('public/style.css')).update(readFileSync('public/app.js')).digest('hex').slice(0, 8);
const out = readFileSync(html, 'utf8').replace(/\/(style\.css|app\.js)(\?v=\w+)?"/g, `/$1?v=${v}"`);
if (!out.includes(`?v=${v}`)) throw new Error('stamp: asset links not found in index.html');
writeFileSync(html, out);
console.log(`stamped v=${v}`);
