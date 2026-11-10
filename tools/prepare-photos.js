// inbox/ の写真を公開用に整える (GitHub Actions で実行。sharp を使う):
//   - HEIC/HEIF → JPG 変換 (libheif の heif-convert を使う。iPhone 対策)
//   - 向きを正しくし、EXIF (位置情報など) を削除
//   - 長辺 1600px に縮小、JPG 品質 85
//   - 拡張子を小文字 .jpg に統一
const fs = require("fs");
const path = require("path");
const { execFileSync, execSync } = require("child_process");
const sharp = require("sharp");

const INBOX = path.resolve(__dirname, "../inbox");
const list = () => fs.readdirSync(INBOX).filter(f => !/^README/i.test(f));

(async () => {
  const heic = list().filter(f => /\.hei[cf]$/i.test(f));
  if (heic.length) {
    execSync("sudo apt-get update -qq && sudo apt-get install -y -qq libheif-examples", { stdio: "inherit" });
    for (const f of heic) {
      const out = f.replace(/\.hei[cf]$/i, ".jpg");
      execFileSync("heif-convert", ["-q", "92", path.join(INBOX, f), path.join(INBOX, out)]);
      fs.unlinkSync(path.join(INBOX, f));
    }
  }
  for (const f of list().filter(f => /\.(jpe?g|png|webp)$/i.test(f))) {
    const src = path.join(INBOX, f);
    const out = path.join(INBOX, f.replace(/\.[^.]+$/, ".jpg"));
    const tmp = out + ".tmp";
    await sharp(src)
      .rotate()                                           // EXIF の向きを反映
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85, mozjpeg: true })               // メタデータは既定で削除される
      .toFile(tmp);
    fs.unlinkSync(src);
    fs.renameSync(tmp, out);
  }
  console.log("inbox/ の写真:");
  for (const f of list()) console.log(`  ${f}  ${(fs.statSync(path.join(INBOX, f)).size / 1024).toFixed(0)} KB`);
})().catch(e => { console.error(e); process.exit(1); });
