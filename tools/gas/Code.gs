/**
 * えどぼり書道教室 HP 更新フォーム (Google Apps Script)
 *
 * 役割 (AI は使わない):
 *   1. setup()          … フォームを作成し、トリガーを設定する (最初に1回だけ実行)
 *   2. onFormSubmit()   … フォーム送信を受け、許可リストを確認し、写真を GitHub の inbox/ に送り、
 *                         GitHub Actions (form-update) を起動する
 *   3. doPost()         … Actions からの完了通知を受け、送信者にメールし、プルダウンを更新する
 *   4. refreshChoices() … 「消すお知らせ」「消す作品」「対象の月」の選択肢をサイトのデータから作り直す
 *
 * スクリプトプロパティ (プロジェクトの設定 → スクリプトプロパティ):
 *   GITHUB_TOKEN    fine-grained PAT。対象リポジトリのみ、Contents: Read and write
 *   GITHUB_REPO     例: NorikoOno/senju-hp-sample
 *   ALLOWED_EMAILS  送信を許可する Google アカウントのメール (カンマ区切り)
 *   NOTIFY_TOKEN    Actions からの通知の合言葉。GitHub の Actions secret NOTIFY_TOKEN と同じ値にする
 *   SITE_URL        例: https://norikoono.github.io/senju-hp-sample/
 *   FORM_ID         setup() が自動で保存する
 */

// ---- フォームの質問タイトル (変えると onFormSubmit が読めなくなるので注意) ----
const Q = {
  kind: 'やりたいこと',
  newsText: 'お知らせの本文',
  newsDate: '日付（空欄なら今日の日付）',
  newsRemove: '消すお知らせ',
  month: '対象の月',
  kids: '幼年・小学生・中学生（木曜）の日にち',
  adult: '高校生・大学生・一般（日曜）の日にち',
  off: '休講日',
  note: 'その月のひとこと',
  title: '展覧会名',
  exNote: '展覧会の一言（例: ○○に出展しました。）',
  photos: '写真',
  captions: '写真ごとの一言（1行に1枚、送った順）',
  worksRemove: '消す作品',
};
const KINDS = [
  ['お知らせを追加', 'news_add'],
  ['お知らせを削除', 'news_remove'],
  ['開講日カレンダー', 'calendar'],
  ['生徒の作品を追加', 'works_add'],
  ['生徒の作品を削除', 'works_remove'],
  ['直前の更新を取り消す', 'revert'],
];
const PROPS = PropertiesService.getScriptProperties();
const prop = k => PROPS.getProperty(k) || '';
const allowedEmails = () => prop('ALLOWED_EMAILS').toLowerCase().split(/[,\s]+/).filter(Boolean);

// =====================================================================
//  1. 初期設定
// =====================================================================
function setup() {
  for (const k of ['GITHUB_TOKEN', 'GITHUB_REPO', 'ALLOWED_EMAILS', 'NOTIFY_TOKEN', 'SITE_URL']) {
    if (!prop(k)) throw new Error(`スクリプトプロパティ ${k} を先に設定してください`);
  }
  let form;
  if (prop('FORM_ID')) {
    form = FormApp.openById(prop('FORM_ID'));
  } else {
    form = FormApp.create('えどぼり書道教室 HP更新');
    PROPS.setProperty('FORM_ID', form.getId());
  }
  if (form.getItems().length === 0) buildForm_(form);

  // トリガーを張り直す
  ScriptApp.getProjectTriggers().forEach(t => {
    if (['onFormSubmit', 'refreshChoices'].includes(t.getHandlerFunction())) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('onFormSubmit').forForm(form).onFormSubmit().create();
  ScriptApp.newTrigger('refreshChoices').timeBased().everyDays(1).atHour(5).create();

  refreshChoices();

  const hasUpload = form.getItems(FormApp.ItemType.FILE_UPLOAD).length > 0;
  console.log([
    '=== setup 完了 ===',
    `編集用URL: ${form.getEditUrl()}`,
    `回答用URL (スマホで開く): ${form.getPublishedUrl()}`,
    hasUpload ? '' : [
      '',
      '★ 残り1つ手作業があります ★',
      '編集用URLを開き、セクション「生徒の作品を追加」の中に質問を1つ追加してください。',
      `  質問文: ${Q.photos}`,
      '  種類: ファイルのアップロード',
      '  設定: 複数ファイルを許可 (最大10)、ファイル形式は「画像」のみ、最大サイズ 10MB',
      '  位置: 「展覧会の一言」と「写真ごとの一言」の間に置くと分かりやすい',
    ].join('\n'),
  ].join('\n'));
}

function buildForm_(form) {
  form.setDescription('更新したい内容を選んで送信してください。1〜3分後に結果をメールでお知らせします。')
      .setConfirmationMessage('受け付けました。1〜3分後に結果をメールでお知らせします。')
      .setCollectEmail(true)
      .setLimitOneResponsePerUser(false)
      .setAllowResponseEdits(false)
      .setShowLinkToRespondAgain(true)
      .setProgressBar(false);
  try { form.setEmailCollectionType(FormApp.EmailCollectionType.VERIFIED); } catch (e) { /* 旧環境では未対応 */ }

  const kind = form.addMultipleChoiceItem().setTitle(Q.kind).setRequired(true);

  const pNewsAdd = form.addPageBreakItem().setTitle('お知らせを追加');
  form.addParagraphTextItem().setTitle(Q.newsText).setRequired(true);
  form.addTextItem().setTitle(Q.newsDate).setHelpText('例: 2026.12.01');

  const pNewsRm = form.addPageBreakItem().setTitle('お知らせを削除');
  form.addListItem().setTitle(Q.newsRemove).setRequired(true).setChoiceValues(['(なし)']);

  const pCal = form.addPageBreakItem().setTitle('開講日カレンダー').setHelpText('その月の日程をまとめて書き直します。');
  form.addListItem().setTitle(Q.month).setRequired(true).setChoiceValues(monthChoices_());
  form.addTextItem().setTitle(Q.kids).setHelpText('例: 4,11,18,25　(ない月は空欄)');
  form.addTextItem().setTitle(Q.adult).setHelpText('例: 7,21　(ない月は空欄)');
  form.addTextItem().setTitle(Q.off).setHelpText('例: 31　(なければ空欄)');
  form.addTextItem().setTitle(Q.note).setHelpText('例: 12/31〜1/4 は冬休みです。');

  const pWorksAdd = form.addPageBreakItem().setTitle('生徒の作品を追加')
    .setHelpText('同じ展覧会名で送ると、その展覧会に写真が追加されます。');
  form.addTextItem().setTitle(Q.title).setRequired(true).setHelpText('例: 第40回 大阪書道展');
  form.addTextItem().setTitle(Q.exNote);
  // ★ ここに「写真」(ファイルのアップロード) を手動で追加する。スクリプトからは作成できない。
  form.addParagraphTextItem().setTitle(Q.captions).setHelpText('例:\n小4 金賞\n小6 銀賞\n中2 特選');

  const pWorksRm = form.addPageBreakItem().setTitle('生徒の作品を削除');
  form.addListItem().setTitle(Q.worksRemove).setRequired(true).setChoiceValues(['(なし)']);

  const pRevert = form.addPageBreakItem().setTitle('直前の更新を取り消す')
    .setHelpText('このまま送信すると、直前にフォームから行った更新を1つ元に戻します。');

  // 各セクションを終えたら送信へ (setGoToPage は「その区切りの直前のページを終えたあと」の動き)
  [pNewsRm, pCal, pWorksAdd, pWorksRm, pRevert].forEach(p => p.setGoToPage(FormApp.PageNavigationType.SUBMIT));
  const pages = { news_add: pNewsAdd, news_remove: pNewsRm, calendar: pCal, works_add: pWorksAdd, works_remove: pWorksRm, revert: pRevert };
  kind.setChoices(KINDS.map(([label, key]) => kind.createChoice(label, pages[key])));
}

function monthChoices_() {
  const out = [];
  const d = new Date();
  for (let i = 0; i < 4; i++) {
    const m = new Date(d.getFullYear(), d.getMonth() + i, 1);
    out.push(`${m.getFullYear()}年${m.getMonth() + 1}月`);
  }
  return out;
}

// =====================================================================
//  2. フォーム送信
// =====================================================================
function onFormSubmit(e) {
  const r = e.response;
  const email = (r.getRespondentEmail() || '').toLowerCase();
  if (!allowedEmails().includes(email)) {
    console.warn(`許可されていない送信者のため無視: ${email || '(不明)'}`);
    return;
  }
  const a = {};
  let fileIds = [];
  r.getItemResponses().forEach(ir => {
    const item = ir.getItem();
    if (item.getType() === FormApp.ItemType.FILE_UPLOAD) fileIds = fileIds.concat(ir.getResponse() || []);
    else a[item.getTitle()] = ir.getResponse();
  });
  const kindLabel = a[Q.kind];
  const kind = (KINDS.find(k => k[0] === kindLabel) || [])[1];
  const responseId = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd-HHmmss');

  try {
    let data = {};
    switch (kind) {
      case 'news_add':     data = { text: a[Q.newsText], date: a[Q.newsDate] }; break;
      case 'news_remove':  data = lookupChoice_('CHOICES_NEWS', a[Q.newsRemove]); break;
      case 'calendar':     data = { month: a[Q.month], kids: a[Q.kids], adult: a[Q.adult], off: a[Q.off], note: a[Q.note] }; break;
      case 'works_add':
        if (!fileIds.length) throw new Error('写真が添付されていません。写真を付けてもう一度送ってください。');
        data = { title: a[Q.title], note: a[Q.exNote], captions: a[Q.captions] };
        uploadPhotos_(fileIds, responseId);
        break;
      case 'works_remove': data = lookupChoice_('CHOICES_WORKS', a[Q.worksRemove]); break;
      case 'revert': break;
      default: throw new Error(`やりたいことが読み取れません: ${kindLabel}`);
    }
    gh_('POST', '/dispatches', { event_type: 'form-update', client_payload: { kind, response_id: responseId, email, data } });
    console.log(`dispatch 送信: ${kind} #${responseId} (${email})`);
  } catch (err) {
    console.error(err);
    GmailApp.sendEmail(email, `【HP更新】受付できませんでした: ${kindLabel || ''}`,
      `${err.message || err}\n\nお手数ですが内容を確認して、もう一度送ってください。`);
  }
}

function uploadPhotos_(fileIds, responseId) {
  const okExt = ['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp'];
  let n = 0;
  for (const id of fileIds) {
    const file = DriveApp.getFileById(id);
    const name = file.getName();
    let ext = (name.split('.').pop() || '').toLowerCase();
    if (!okExt.includes(ext)) {
      const mime = file.getMimeType();
      ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : /heic|heif/.test(mime) ? 'heic' : 'jpg';
    }
    n += 1;
    const dest = `inbox/${responseId}-${String(n).padStart(2, '0')}.${ext}`;
    gh_('PUT', `/contents/${dest}`, {
      message: `photo: ${dest} (${name})`,
      content: Utilities.base64Encode(file.getBlob().getBytes()),
    });
    file.setTrashed(true);
  }
}

function lookupChoice_(propKey, label) {
  const map = JSON.parse(prop(propKey) || '{}');
  if (!label || !map[label]) throw new Error('選択した項目が見つかりませんでした。フォームを開き直して、もう一度選んでください。');
  return map[label];
}

// =====================================================================
//  3. Actions からの完了通知 → メール
// =====================================================================
function doPost(e) {
  let p = {};
  try { p = JSON.parse(e.postData.contents); } catch (_) {}
  if (!p.token || p.token !== prop('NOTIFY_TOKEN')) return json_({ ok: false, error: 'bad token' });

  const kindLabel = (KINDS.find(k => k[1] === p.kind) || [p.kind || ''])[0];
  const ok = p.job_status === 'success';
  let subject, body = (p.summary || '').trim() + '\n\n';
  if (!ok) {
    subject = `【HP更新】失敗: ${kindLabel}`;
    body += `サイトは変更されていません。\n実行ログ: ${p.run_url || ''}\n`;
  } else if (p.change_status === 'nochange') {
    subject = `【HP更新】変更なし: ${kindLabel}`;
  } else {
    subject = `【HP更新】完了: ${kindLabel}`;
    body += `1〜2分で公開サイトに反映されます。\n${prop('SITE_URL')}\n`;
  }
  const to = (p.email || '').toLowerCase();
  if (allowedEmails().includes(to)) GmailApp.sendEmail(to, subject, body);

  try { refreshChoices(); } catch (err) { console.warn(err); }
  return json_({ ok: true });
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// =====================================================================
//  4. プルダウンの選択肢をサイトのデータから作り直す
// =====================================================================
function refreshChoices() {
  const form = FormApp.openById(prop('FORM_ID'));
  const news = loadData_('news.js', 'NEWS') || [];
  const works = loadData_('works.js', 'WORKS') || [];

  const newsMap = {}, newsLabels = [];
  news.forEach((n, i) => {
    const label = unique_(trunc_(`${n.date ? n.date + '　' : ''}${n.text}`, 70), newsLabels);
    newsLabels.push(label); newsMap[label] = { date: n.date || '', text: n.text };
  });
  const worksMap = {}, worksLabels = [];
  works.forEach(ex => {
    const l = unique_(`【展覧会ごと】${ex.title}`, worksLabels);
    worksLabels.push(l); worksMap[l] = { target: 'exhibition', title: ex.title };
    (ex.items || []).forEach((w, i) => {
      const l2 = unique_(trunc_(`${ex.title}｜${i + 1}枚目 ${w.caption || ''}`.trim(), 70), worksLabels);
      worksLabels.push(l2); worksMap[l2] = { target: 'item', title: ex.title, src: w.src };
    });
  });

  setChoices_(form, Q.newsRemove, newsLabels);
  setChoices_(form, Q.worksRemove, worksLabels);
  setChoices_(form, Q.month, monthChoices_());
  PROPS.setProperty('CHOICES_NEWS', JSON.stringify(newsMap));
  PROPS.setProperty('CHOICES_WORKS', JSON.stringify(worksMap));
  console.log(`選択肢を更新: お知らせ ${newsLabels.length} 件, 作品 ${worksLabels.length} 件`);
}

function setChoices_(form, title, labels) {
  const item = form.getItems(FormApp.ItemType.LIST).find(i => i.getTitle() === title);
  if (!item) { console.warn(`質問が見つかりません: ${title}`); return; }
  item.asListItem().setChoiceValues(labels.length ? labels : ['(なし)']);
}
function trunc_(s, n) { s = String(s).replace(/\s+/g, ' '); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function unique_(label, used) { let l = label, i = 2; while (used.includes(l)) l = `${label} (${i++})`; return l; }

function loadData_(file, name) {
  const res = gh_('GET', `/contents/${file}?ref=main`);
  const src = Utilities.newBlob(Utilities.base64Decode(res.content.replace(/\n/g, ''))).getDataAsString('UTF-8');
  return new Function(`${src}\n;return ${name};`)();
}

// =====================================================================
//  GitHub API
// =====================================================================
function gh_(method, path, body) {
  const res = UrlFetchApp.fetch(`https://api.github.com/repos/${prop('GITHUB_REPO')}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${prop('GITHUB_TOKEN')}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    contentType: 'application/json',
    payload: body ? JSON.stringify(body) : undefined,
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode(), text = res.getContentText();
  if (code >= 300) throw new Error(`GitHub API エラー (${method} ${path}): ${code} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}

// =====================================================================
//  動作確認用: エディタから実行すると、お知らせを1件追加する依頼を送る
// =====================================================================
function sendTest() {
  const email = allowedEmails()[0];
  gh_('POST', '/dispatches', {
    event_type: 'form-update',
    client_payload: {
      kind: 'news_add',
      response_id: Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd-HHmmss'),
      email,
      data: { text: 'テスト投稿です（あとで「直前の更新を取り消す」で消せます）', date: '' },
    },
  });
  console.log(`テスト依頼を送りました。結果は ${email} にメールで届きます。`);
}
