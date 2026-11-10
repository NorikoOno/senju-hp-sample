// AI の編集結果を commit 前に検査する。
//   1. 変更されたファイルが許可された範囲内か
//   2. news.js / calendar.js / works.js が正しく読み込めるか
//   3. works.js が参照する写真が存在するか
// 1 つでも引っかかれば exit 1 (commit されない)。
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const ALLOWED = [/^news\.js$/, /^calendar\.js$/, /^works\.js$/, /^works\//, /^inbox\//];
const errors = [];

// 1. 変更ファイル
const changed = execSync("git status --porcelain", { cwd: ROOT, encoding: "utf8" })
  .split("\n").filter(Boolean)
  .map(l => l.slice(3).trim().replace(/^"|"$/g, ""))
  .flatMap(p => (p.includes(" -> ") ? p.split(" -> ") : [p]));
for (const p of changed) {
  if (!ALLOWED.some(re => re.test(p))) errors.push(`許可されていないファイルが変更されています: ${p}`);
}

// 2. データファイルの読み込み
function load(file, name) {
  const src = fs.readFileSync(path.join(ROOT, file), "utf8");
  const ctx = {};
  try {
    vm.runInNewContext(`${src}\n;__out = ${name};`, ctx, { filename: file, timeout: 1000 });
  } catch (e) {
    errors.push(`${file} が読み込めません: ${e.message}`);
    return undefined;
  }
  return ctx.__out;
}
const news = load("news.js", "NEWS");
const cal = load("calendar.js", "CALENDAR");
const works = load("works.js", "WORKS");

if (news !== undefined && !Array.isArray(news)) errors.push("news.js: NEWS は配列である必要があります");
if (Array.isArray(news)) news.forEach((n, i) => {
  if (!n || typeof n.text !== "string" || !n.text.trim()) errors.push(`news.js: ${i + 1}件目に text がありません`);
});

if (cal !== undefined && (typeof cal !== "object" || Array.isArray(cal) || cal === null)) errors.push("calendar.js: CALENDAR はオブジェクトである必要があります");
if (cal && typeof cal === "object") for (const [k, v] of Object.entries(cal)) {
  if (!/^\d{4}-\d{2}$/.test(k)) errors.push(`calendar.js: 月のキー "${k}" は "YYYY-MM" 形式にしてください`);
  const days = new Date(+k.slice(0, 4), +k.slice(5, 7), 0).getDate();
  for (const key of ["kids", "adult", "off"]) {
    const arr = v?.[key];
    if (arr === undefined) continue;
    if (!Array.isArray(arr)) { errors.push(`calendar.js: ${k}.${key} は配列にしてください`); continue; }
    arr.forEach(d => { if (!Number.isInteger(d) || d < 1 || d > days) errors.push(`calendar.js: ${k}.${key} の "${d}" は 1〜${days} の整数にしてください`); });
  }
}

if (works !== undefined && !Array.isArray(works)) errors.push("works.js: WORKS は配列である必要があります");
if (Array.isArray(works)) works.forEach((ex, i) => {
  if (!ex || !Array.isArray(ex.items)) { errors.push(`works.js: ${i + 1}番目の展覧会に items がありません`); return; }
  ex.items.forEach((w, j) => {
    if (!w || typeof w.src !== "string") { errors.push(`works.js: ${i + 1}番目の展覧会 ${j + 1}枚目に src がありません`); return; }
    if (!w.src.startsWith("works/")) errors.push(`works.js: src は works/ 配下にしてください: ${w.src}`);
    if (!fs.existsSync(path.join(ROOT, w.src))) errors.push(`works.js: 写真が見つかりません: ${w.src}`);
  });
});

// 3. 大きすぎるファイル
for (const p of changed) {
  const full = path.join(ROOT, p);
  if (fs.existsSync(full) && fs.statSync(full).isFile() && fs.statSync(full).size > 5 * 1024 * 1024)
    errors.push(`ファイルが大きすぎます (5MB超): ${p}`);
}

if (errors.length) {
  console.error("検証エラー:\n- " + errors.join("\n- "));
  process.exit(1);
}
console.log(`検証OK (変更 ${changed.length} ファイル)`);
