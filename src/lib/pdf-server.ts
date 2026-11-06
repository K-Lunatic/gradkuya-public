import { extractText, getDocumentProxy } from "unpdf";
import { join, sep } from "node:path";

export function extractPdfText(data: Uint8Array, mergePages: true): Promise<{ totalPages: number; text: string }>;
export function extractPdfText(data: Uint8Array, mergePages?: false): Promise<{ totalPages: number; text: string[] }>;
export async function extractPdfText(data: Uint8Array, mergePages = false) {
  const pdf = await getDocumentProxy(data, {
    cMapUrl: join(process.cwd(), "node_modules", "pdfjs-dist", "cmaps") + sep,
    cMapPacked: true,
    standardFontDataUrl: join(process.cwd(), "node_modules", "pdfjs-dist", "standard_fonts") + sep,
  });
  try {
    return mergePages ? await extractText(pdf, { mergePages: true }) : await extractText(pdf, { mergePages: false });
  } finally {
    await pdf.loadingTask.destroy();
  }
}
