// ============================================================
//  生徒の作品
//  ・フォームから更新されます（手で直す場合は下の形式で）
//  ・展覧会ごとに { title, note, items }、items は { src, caption }
//  ・上に書いた展覧会が先に表示されます
// ============================================================
const WORKS = [
  {
    title: "【テスト】動作確認展",
    note: "テストです。",
    items: [
      { src: "works/20261110-112126/01.jpg", caption: "小4 金賞" },
      { src: "works/20261110-112126/02.jpg", caption: "小6 銀賞" },
    ],
  },
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
