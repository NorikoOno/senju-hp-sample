// ============================================================
//  生徒の作品（このファイルと works/ フォルダだけ触ればOK）
//
//  ・写真は works/ フォルダに入れてください（例: works/2026-shoten/01.jpg）
//  ・展覧会ごとにひとまとまり { title, note, items } で書きます
//      title   … 見出し（例: 第40回 ○○書道展）
//      note    … 一言（例: ○○に出展しました。）
//      items   … 写真の一覧。src に写真のパス、caption に一言
//  ・上に書いた展覧会が先に表示されます
//  ・title / note / caption は省略できます
//  ・写真をクリックすると拡大表示されます
// ============================================================
const WORKS = [
  {
    title: "第○回 ○○書道展",
    note: "○○に出展しました。",
    items: [
      { src: "works/sample/01.jpg", caption: "小4 金賞" },
      { src: "works/sample/02.jpg", caption: "小6 銀賞" },
      { src: "works/sample/03.jpg", caption: "中2 特選" },
      { src: "works/sample/04.jpg", caption: "一般 入選" },
    ],
  },
];
