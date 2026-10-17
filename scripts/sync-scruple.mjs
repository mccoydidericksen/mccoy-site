// Copies the two Scruple demos (shortage check, sample margin board) from the rxledger repo into
// this site, rewriting their absolute paths to live under /scruple. The rxledger repo is private,
// so Vercel can't fetch it at build time; run this locally and commit the result.
//
//   npm run sync:scruple                      # from ../rxledger/site/public
//   npm run sync:scruple -- path/to/public    # from elsewhere
//
// Every rewrite must match, so a change on the Scruple side fails loudly instead of shipping a
// page with dead links.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const src = process.argv[2] ?? new URL("../../rxledger/site/public", import.meta.url).pathname;
const root = new URL("..", import.meta.url).pathname;
const assets = join(root, "public/scruple/assets");
const data = join(root, "public/scruple/data");
mkdirSync(assets, { recursive: true });
mkdirSync(data, { recursive: true });

function rewrite(text, file, pairs) {
  for (const [from, to] of pairs) {
    if (!text.includes(from)) throw new Error(`${file}: expected to find ${JSON.stringify(from)}`);
    text = text.replaceAll(from, to);
  }
  return text;
}

for (const f of ["base.css", "site.css", "shortage.css", "shortage-lib.js", "favicon.svg"]) {
  copyFileSync(join(src, f), join(assets, f));
}
for (const f of ["shortage-bundle.json", "shortage-sample.csv"]) {
  copyFileSync(join(src, "data", f), join(data, f));
}

writeFileSync(
  join(assets, "shortage.js"),
  rewrite(readFileSync(join(src, "shortage.js"), "utf8"), "shortage.js", [
    ['"/shortage-lib.js"', '"/scruple/assets/shortage-lib.js"'],
    ['"/data/', '"/scruple/data/'],
  ]),
);

// Session replay must not record what a visitor pastes: the page promises the list never leaves
// the browser. ph-no-capture blocks an element from both autocapture and recordings.
let shortage = readFileSync(join(src, "shortage.html"), "utf8");
shortage = shortage.replace(/<nav class="top-nav">[\s\S]*?<\/nav>/, () =>
  '<nav class="top-nav"><a href="/scruple/board" class="top-link wide-only">Example</a><a href="/scruple" class="top-link">About Scruple</a></nav>');
shortage = rewrite(shortage, "shortage.html", [
  ['href="/favicon.svg"', 'href="/scruple/assets/favicon.svg"'],
  ['href="/base.css"', 'href="/scruple/assets/base.css"'],
  ['href="/site.css"', 'href="/scruple/assets/site.css"'],
  ['href="/shortage.css"', 'href="/scruple/assets/shortage.css"'],
  ['src="/shortage.js"', 'src="/scruple/assets/shortage.js"'],
  ['<a href="/" class="wordmark top-mark"', '<a href="/scruple" class="wordmark top-mark"'],
  ['<a href="/#send">Send a report</a>', '<a href="/scruple">About Scruple</a>'],
  ['<section class="sc-input"', '<section class="sc-input ph-no-capture"'],
  ['<section class="sc-results"', '<section class="sc-results ph-no-capture"'],
]);
writeFileSync(join(root, "src/demos/shortage.html"), shortage);

const board = rewrite(readFileSync(join(src, "board.html"), "utf8"), "board.html", [
  ['<a class="wordmark" href="/">', '<a class="wordmark" href="/scruple">'],
  ['<a href="/">← Back to the site</a>', '<a href="/scruple">← About Scruple</a>'],
  ['href="/favicon.svg"', 'href="/scruple/assets/favicon.svg"'],
]);
writeFileSync(join(root, "src/demos/board.html"), board);

console.log(`synced Scruple demos from ${src}`);
