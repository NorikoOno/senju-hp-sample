# えどぼり書道教室 Webサイト

公開URL: https://norikoono.github.io/senju-hp-sample/

## 日常の更新 (スマホのフォームから)

お知らせ・開講日カレンダー・生徒の作品は、Google フォームから更新できます。
送信すると GitHub Actions がデータファイルを書き換えて公開し、結果がメールで届きます。AI は使っていません。

- 仕組みの説明: [docs/adr/0001-form-to-github-update.md](docs/adr/0001-form-to-github-update.md)
- フォームと GAS の初期設定: [tools/gas/README.md](tools/gas/README.md)

## 手で直す場合

| 更新したいもの | 編集するファイル | 写真の置き場所 |
|---|---|---|
| お知らせ | `news.js` | - |
| 開講日カレンダー | `calendar.js` | - |
| 生徒の作品 | `works.js` | `works/` |
| トップ・講師・教室の様子の写真 | - | `images/` (`images/README.md` 参照) |
| 月謝・講師紹介など上記以外 | `index.html` | - |

各ファイルの先頭に書き方のコメントがあります。
編集したら commit して push すると、1〜2分で公開サイトに反映されます。

## 開発メモ

```
node tools/validate.js                       # データファイルの検査
PAYLOAD='{"kind":"news_add","data":{"text":"テスト"}}' node tools/apply-update.js   # フォーム処理の手元実行
```
