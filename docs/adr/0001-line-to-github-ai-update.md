# ADR-0001: LINE から AI 経由で HP を更新する仕組み

- 状態: 提案 (2026-11-10)
- 決定者: サイト運営者
- 関連: [README](../../README.md)

## 背景

えどぼり書道教室の HP は GitHub Pages で公開している静的サイト。
日常的に書き換えるのは次の 3 つだけで、いずれも専用のデータファイルに分離済み。

| 更新内容 | ファイル | 写真 |
|---|---|---|
| お知らせ | `news.js` | - |
| 開講日カレンダー | `calendar.js` | - |
| 生徒の作品の掲載・削除 | `works.js` | `works/` |

運営者は PC を開かず、手元の LINE から「12月の子どもは 4,11,18,25」「この写真は小4金賞」のように
日本語で指示するだけで更新したい。GitHub の操作や JS の編集は AI に任せる。

## 決定

```
 スマホ LINE                Cloudflare Worker                GitHub                          GitHub Pages
 ───────────            ─────────────────────         ─────────────────────────────        ────────────
 写真を送る ─────webhook──▶ 署名検証・送信者チェック ──▶ inbox/ に写真をコミット
 文章で指示 ─────webhook──▶ 同上                    ──▶ repository_dispatch で Actions 起動
                                                        │
                                                        ▼
                                                  GitHub Actions
                                                  Claude Code が指示を読み
                                                  news.js / calendar.js / works.js /
                                                  works/ だけを編集 → 検証 → main に commit ──▶ 1〜2分で公開
                                                        │
 結果を受け取る ◀────LINE push API───────────────────────┘
 「取り消し」 ─────webhook──▶ ... ──▶ 直前の bot commit を revert
```

### D1. 入口は LINE Messaging API + 薄い Cloudflare Worker

- LINE 公式アカウント (Messaging API) の webhook を Cloudflare Worker で受ける。
- Worker の仕事は 4 つだけ。署名検証、送信者 userId の許可リスト照合、写真の受け取り、GitHub への橋渡し。
- Worker には AI を置かない。AI は GitHub 側で動かす (D2)。

理由: LINE の webhook を受けるには公開 HTTPS エンドポイントが必要で、GitHub 単体では受けられない。
Worker は無料枠で足り、サーバー管理が要らない。ロジックを持たせないので壊れにくい。

### D2. AI は GitHub Actions 上の Claude Code で動かす

- Worker は `repository_dispatch` でイベント `line-update` を送るだけ。
- Actions のジョブで Claude Code (`anthropics/claude-code-action` または `claude -p`) を起動し、
  LINE の文章と `inbox/` の写真を渡して編集させる。
- 作業ログは Actions の実行履歴として残る。

理由: 編集対象がリポジトリそのものなので git の上で動かすのが自然。
何をどう変えたかが commit と Actions ログで追える。Worker 内で独自のエージェントループを書くより保守が楽。
公開リポジトリなので Actions の実行時間は無料。

検討した代替: Worker から Claude API を直接呼び GitHub API でファイルを書く案。
応答は速いが、ツール呼び出しループを自前実装することになり、デバッグも難しい。採用しない。

### D3. 写真は `inbox/` を経由する (状態を持たない)

- 写真が届くたびに Worker が GitHub Contents API で `inbox/<日時>-<連番>.jpg` にコミットする。
- 文章の指示が届いたら Actions が起動し、AI は「`inbox/` にある写真 = 今回の指示の対象」として扱う。
- AI が `works/<展覧会スラッグ>/` に移動し、`works.js` に追記し、`inbox/` を空にする。
- Actions 側で写真をリサイズ (長辺 1600px) し、EXIF (位置情報など) を削除してから配置する。

理由: 「写真を先に送って、あとから文章で説明する」という LINE の自然な使い方に合う。
Worker に KV や R2 などの保存先を用意しなくて済み、リポジトリだけが唯一の状態になる。

### D4. 直接 main にコミットし、「取り消し」で戻す

- 承認ステップは置かず、AI の編集結果をそのまま main にコミットして公開する。
- 完了後、変更内容の要約と公開 URL を LINE に push で返す。
- 「取り消し」「戻して」と送ると、直前の bot コミットを `git revert` して公開し直す。

理由: 更新内容は低リスクで、間違えてもすぐ直せる。承認フロー (PR を作って LINE で OK を待つ) は
会話の状態管理が必要になり、仕組みが一段複雑になる。運用してみて誤更新が多ければ
「プレビュー → OK で公開」に切り替える (その場合は ADR を追加する)。

### D5. ガードレール

AI に自由に書かせるが、守らせる範囲は仕組み側で強制する。

| 項目 | 方法 |
|---|---|
| 送信者の制限 | Worker が LINE userId を許可リストと照合。それ以外は無視 |
| 編集できるファイル | Actions で `git diff --name-only` を検査。`news.js` `calendar.js` `works.js` `works/**` `inbox/**` 以外に差分があれば commit せず失敗させる |
| データの壊れ防止 | commit 前に `node --check` と読み込みテストで配列・オブジェクトとして読めることを確認 |
| 生徒のプライバシー | AI への指示書で、キャプションに生徒のフルネームを書かないこと、顔が写る写真はそのまま載せないことを明記。該当しそうな場合は LINE に確認を返す |
| 失敗時 | エラー内容を LINE に返す。サイトは直前の状態のまま |
| 秘密情報 | LINE チャネルシークレット・アクセストークン、GitHub トークン、Anthropic API キーはそれぞれ Worker secrets / Actions secrets に置く。リポジトリには入れない |

## 使い方のイメージ

| LINE で送るもの | 起きること |
|---|---|
| 「お知らせ: 12/23(火)はお休みです」 | `news.js` の先頭に追加 |
| 「12月の子どもは 4,11,18,25。一般は 7,21。31日は休講」 | `calendar.js` の 2026-12 を書き換え |
| 写真 3 枚 → 「第40回 大阪書道展に出展。左から小4金賞、小6銀賞、中2特選」 | `works/2026-12-osaka-shodoten/` に配置、`works.js` に追記 |
| 「大阪書道展の小6銀賞を消して」 | `works.js` から該当項目と写真を削除 |
| 「取り消し」 | 直前の更新を revert |
| 「今のお知らせ見せて」 | 変更せず内容を返信 |

## 結果 (Consequences)

良い点

- 運営者は LINE だけで完結し、GitHub や JS を触らない。
- 変更履歴がすべて git に残り、いつでも戻せる。
- 追加のサーバーやデータベースがない。Worker・Actions・Pages はいずれも無料枠内。

注意点

- 反映まで 1〜3 分かかる (Actions 起動 + Pages ビルド)。即時ではない。
- LINE 公式アカウントの無料プランは push 通知が月 200 通まで。結果通知は 1 更新 1 通なので足りる見込み。
- Anthropic API の費用が 1 更新あたり数円〜十数円かかる。
- LINE Developers、Cloudflare、Anthropic の各アカウント作成は運営者本人が行う必要がある。

## 構築の順序

1. LINE Developers で Messaging API チャネルを作成し、公式アカウントを運営者の LINE に友だち追加する (運営者)
2. Cloudflare アカウントと Anthropic API キーを用意する (運営者)
3. Worker を実装・デプロイし、LINE の webhook URL に設定する
4. `.github/workflows/line-update.yml` と AI への指示書 `docs/ai-editor-guide.md` を追加する
5. テスト用の指示を LINE から送り、お知らせ → カレンダー → 作品の順で動作確認する
6. 「取り消し」の動作を確認する
