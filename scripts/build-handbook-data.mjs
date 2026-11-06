import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import { PDFParse } from "pdf-parse";

const inputs = process.argv.slice(2);

const files = (await Promise.all(inputs.map(findPdfs))).flat();
const sources = files.map((file) => {
  const year = Number(basename(file).match(/20\d{2}/)?.[0]);
  if (!year) throw new Error(`파일명에서 연도를 찾을 수 없습니다: ${file}`);
  return { year, file, title: basename(file, ".pdf") };
}).sort((a, b) => a.year - b.year);

const output = join(process.cwd(), "src", "data", "handbooks");
const cMapUrl = join(process.cwd(), "node_modules", "pdfjs-dist", "cmaps") + sep;
await mkdir(output, { recursive: true });
for (const source of sources) {
  const parser = new PDFParse({ data: await readFile(source.file), cMapUrl, cMapPacked: true });
  const result = await parser.getText();
  await parser.destroy();
  const handbook = {
    year: source.year,
    title: source.title,
    pages: result.pages.map((page) => ({ page: page.num, text: page.text.replace(/\0/g, "") })),
  };
  await writeFile(join(output, `${source.year}.json`), JSON.stringify(handbook));
  console.log(`${source.year}: ${result.total} pages`);
}

const handbooks = await Promise.all(
  (await readdir(output))
    .filter((name) => /^20\d{2}\.json$/.test(name))
    .map(async (name) => JSON.parse(await readFile(join(output, name), "utf8"))),
);
handbooks.sort((a, b) => a.year - b.year);
await writeFile(join(output, "index.json"), JSON.stringify(handbooks));
console.log(`index.json: ${handbooks.map((handbook) => handbook.year).join(", ")}`);

async function findPdfs(input) {
  const path = resolve(input);
  if (!(await stat(path)).isDirectory()) return path.toLowerCase().endsWith(".pdf") ? [path] : [];
  return (await readdir(path))
    .filter((name) => /요람.*\.pdf$/i.test(name))
    .map((name) => join(path, name));
}
