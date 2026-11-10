// フォームからの依頼 (PAYLOAD 環境変数の JSON) を受け取り、
// news.js / calendar.js / works.js / works/ を決定的に書き換える。AI は使わない。
// 結果の要約を RESULT_FILE (既定: 一時ディレクトリの result.md) に書く。失敗時は exit 1。
//
// PAYLOAD 例:
//   { kind: "news_add",     response_id, email, data: { text, date } }
//   { kind: "news_remove",  data: { text, date } }
//   { kind: "calendar",     data: { month: "2026-12" | "2026年12月", kids, adult, off, note } }
//   { kind: "works_add",    data: { title, note, captions } }   ← 写真は inbox/<response_id>-*.jpg
//   { kind: "works_remove", data: { target: "item"|"exhibition", title, src } }
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const os = require("os");

const ROOT = path.resolve(__dirname, "..");
const RESULT = process.env.RESULT_FILE || path.join(os.tmpdir(), "result.md");
const payload = JSON.parse(process.env.PAYLOAD || "{}");
const kind = payload.kind;
const data = payload.data || {};
const responseId = String(payload.response_id || "").replace(/[^0-9A-Za-z_-]/g, "") || stamp();
const out = [];
const fail = msg => { throw new Error(msg); };

function stamp() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return d.toISOString().replace(/[-:T]/g, "").slice(0, 15).replace(/(\d{8})(\d{6})/, "$1-$2");
}
function todayJst() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${String(d.getUTCDate()).padStart(2, "0")}`;
}
function load(file, name) {
  const p = path.join(ROOT, file);
  if (!fs.existsSync(p)) return undefined;
  const ctx = {};
  vm.runInNewContext(`${fs.readFileSync(p, "utf8")}\n;__out = ${name};`, ctx, { filename: file });
  return ctx.__out;
}
const q = s => JSON.stringify(String(s ?? ""));
const str = v => String(v ?? "").trim();

// ---------- 書き出し (人が読んで直せる形を保つ) ----------
function writeNews(list) {
  const body = list.map(n => `  { date: ${q(n.date)}, text: ${q(n.text)} },`).join("\n");
  fs.writeFileSync(path.join(ROOT, "news.js"), `// ============================================================
//  お知らせ
//  ・フォームから更新されます（手で直す場合は 1行1件、上が先に表示）
//  ・{ date: "日付", text: "本文" }  date は省略可
//  ・全部消すとお知らせ欄ごと非表示になります
// ============================================================
const NEWS = [
${body}
];
`);
}
function writeCalendar(cal) {
  const months = Object.keys(cal).sort();
  const body = months.map(m => {
    const v = cal[m];
    const arr = a => `[${(a || []).join(", ")}]`;
    return `  ${q(m)}: {
    kids:  ${arr(v.kids)},
    adult: ${arr(v.adult)},
    off:   ${arr(v.off)},
    note:  ${q(v.note)},
  },`;
  }).join("\n");
  fs.writeFileSync(path.join(ROOT, "calendar.js"), `// ============================================================
//  開講日カレンダー
//  ・フォームから更新されます（手で直す場合は月ごとに日にちを数字で）
//      kids  … 幼年・小学生・中学生（木曜）
//      adult … 高校生・大学生・一般（日曜）
//      off   … 休講日
//      note  … その月のひとこと
//  ・書いた月だけ表示されます
// ============================================================
const CALENDAR = {
${body}
};
`);
}
function writeWorks(list) {
  const body = list.map(ex => `  {
    title: ${q(ex.title)},
    note: ${q(ex.note)},
    items: [
${ex.items.map(w => `      { src: ${q(w.src)}, caption: ${q(w.caption)} },`).join("\n")}
    ],
  },`).join("\n");
  fs.writeFileSync(path.join(ROOT, "works.js"), `// ============================================================
//  生徒の作品
//  ・フォームから更新されます（手で直す場合は下の形式で）
//  ・展覧会ごとに { title, note, items }、items は { src, caption }
//  ・上に書いた展覧会が先に表示されます
// ============================================================
const WORKS = [
${body}
];
`);
}

// ---------- 入力の解釈 ----------
function parseDays(s, month) {
  const [y, m] = month.split("-").map(Number);
  const max = new Date(y, m, 0).getDate();
  const parts = str(s).replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).split(/[^0-9]+/).filter(Boolean);
  const days = [...new Set(parts.map(Number))].sort((a, b) => a - b);
  for (const d of days) if (d < 1 || d > max) fail(`${month} に ${d} 日はありません (1〜${max})`);
  return days;
}
function parseMonth(s) {
  s = str(s).replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  let m = s.match(/^(\d{4})[-/.年](\d{1,2})月?$/);
  if (!m) fail(`対象の月が読み取れません: "${s}"`);
  return `${m[1]}-${String(Number(m[2])).padStart(2, "0")}`;
}

// ---------- 各処理 ----------
const handlers = {
  news_add() {
    const text = str(data.text); if (!text) fail("お知らせの本文が空です");
    const date = str(data.date) || todayJst();
    const list = load("news.js", "NEWS") || [];
    list.unshift({ date, text });
    writeNews(list);
    out.push(`お知らせを追加しました。`, ``, `${date}　${text}`);
  },
  news_remove() {
    const list = load("news.js", "NEWS") || [];
    const text = str(data.text), date = str(data.date);
    const i = list.findIndex(n => str(n.text) === text && (!date || str(n.date) === date));
    if (i < 0) fail(`該当するお知らせが見つかりません: ${text}`);
    const [removed] = list.splice(i, 1);
    writeNews(list);
    out.push(`お知らせを削除しました。`, ``, `${removed.date || ""}　${removed.text}`);
  },
  calendar() {
    const month = parseMonth(data.month);
    const cal = load("calendar.js", "CALENDAR") || {};
    const entry = {
      kids: parseDays(data.kids, month),
      adult: parseDays(data.adult, month),
      off: parseDays(data.off, month),
      note: str(data.note),
    };
    cal[month] = entry;
    writeCalendar(cal);
    const [y, m] = month.split("-");
    out.push(`${Number(y)}年${Number(m)}月の開講日を更新しました。`, ``,
      `こども(木曜): ${entry.kids.join(", ") || "なし"}`,
      `一般(日曜): ${entry.adult.join(", ") || "なし"}`,
      `休講: ${entry.off.join(", ") || "なし"}`,
      entry.note ? `ひとこと: ${entry.note}` : "");
  },
  works_add() {
    const title = str(data.title); if (!title) fail("展覧会名が空です");
    const note = str(data.note);
    const captions = str(data.captions).split(/\r?\n/).map(s => s.trim());
    const inbox = path.join(ROOT, "inbox");
    const all = fs.existsSync(inbox) ? fs.readdirSync(inbox).filter(f => /\.jpe?g$/i.test(f)).sort() : [];
    const mine = all.filter(f => f.startsWith(responseId + "-"));
    if (!mine.length) fail("写真が届いていません。写真を付けてもう一度送ってください");
    const dir = `works/${responseId}`;
    fs.mkdirSync(path.join(ROOT, dir), { recursive: true });
    const items = mine.map((f, i) => {
      const dest = `${dir}/${String(i + 1).padStart(2, "0")}.jpg`;
      fs.renameSync(path.join(inbox, f), path.join(ROOT, dest));
      return { src: dest, caption: captions[i] || "" };
    });
    // 過去に失敗して残った写真は片付ける
    for (const f of all.filter(f => !mine.includes(f))) fs.unlinkSync(path.join(inbox, f));
    const list = load("works.js", "WORKS") || [];
    const existing = list.find(ex => str(ex.title) === title);
    if (existing) { existing.items.push(...items); if (note) existing.note = note; }
    else list.unshift({ title, note, items });
    writeWorks(list);
    out.push(`「${title}」に作品を${items.length}点${existing ? "追加" : "掲載"}しました。`, ``,
      ...items.map((w, i) => `${i + 1}枚目: ${w.caption || "(一言なし)"}`));
    if (captions.filter(Boolean).length > items.length) out.push(``, `※ 一言の行数が写真より多かったため、余りは使っていません。`);
  },
  works_remove() {
    const list = load("works.js", "WORKS") || [];
    const title = str(data.title);
    const ex = list.find(e => str(e.title) === title);
    if (!ex) fail(`該当する展覧会が見つかりません: ${title}`);
    const rm = src => { const p = path.join(ROOT, src); if (fs.existsSync(p)) fs.unlinkSync(p); };
    if (data.target === "exhibition") {
      ex.items.forEach(w => rm(w.src));
      list.splice(list.indexOf(ex), 1);
      out.push(`「${title}」の作品 ${ex.items.length} 点をすべて削除しました。`);
    } else {
      const src = str(data.src);
      const i = ex.items.findIndex(w => str(w.src) === src);
      if (i < 0) fail(`該当する作品が見つかりません: ${src}`);
      const [w] = ex.items.splice(i, 1); rm(w.src);
      if (!ex.items.length) list.splice(list.indexOf(ex), 1);
      out.push(`「${title}」から作品を1点削除しました。`, ``, `${w.caption || "(一言なし)"}`);
      if (!ex.items.length) out.push(``, `作品がなくなったので展覧会の見出しも消しました。`);
    }
    // 空になったフォルダを消す
    const dir = path.join(ROOT, "works");
    for (const d of fs.readdirSync(dir)) { const p = path.join(dir, d); if (fs.statSync(p).isDirectory() && !fs.readdirSync(p).length) fs.rmdirSync(p); }
    writeWorks(list);
  },
};

try {
  if (!handlers[kind]) fail(`不明な依頼の種類です: ${kind}`);
  handlers[kind]();
  fs.writeFileSync(RESULT, out.filter(l => l !== undefined).join("\n") + "\n");
  console.log(out.join("\n"));
} catch (e) {
  fs.writeFileSync(RESULT, `更新できませんでした。\n\n${e.message}\n`);
  console.error("エラー: " + e.message);
  process.exit(1);
}
