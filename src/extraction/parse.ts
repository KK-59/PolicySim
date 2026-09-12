/**
 * Document -> text. PDF / DOCX / MD / TXT.
 *
 * OWNER: Oriol (contract), implemented here so extraction has something to read.
 *
 * Runs on the SERVER, not in the browser. Not for performance — the OpenAI call that follows
 * needs a key, and a key shipped to the browser is a key published. The parse goes where the key
 * already is.
 */

export type DocumentFormat = 'pdf' | 'docx' | 'md' | 'txt';

export interface ParsedDocument {
  text: string;
  format: DocumentFormat;
  /** Pages for a PDF; 1 for everything else. */
  pages: number;
  /** Characters of extracted text. Zero from a real file means a scan, not an empty document. */
  chars: number;
}

export function formatOf(filename: string): DocumentFormat {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'docx' || ext === 'doc') return 'docx';
  if (ext === 'md' || ext === 'markdown') return 'md';
  return 'txt';
}

export async function parseDocument(
  bytes: Uint8Array,
  filename: string,
): Promise<ParsedDocument> {
  const format = formatOf(filename);
  const text = format === 'pdf'
    ? await parsePdf(bytes)
    : format === 'docx'
      ? await parseDocx(bytes)
      : new TextDecoder().decode(bytes);

  const cleaned = tidy(text);
  return {
    text: cleaned,
    format,
    pages: format === 'pdf' ? await pdfPageCount(bytes) : 1,
    chars: cleaned.length,
  };
}

/**
 * Collapse the whitespace a PDF extractor leaves behind, without joining paragraphs.
 *
 * Worth doing before the model sees it: ragged line breaks mid-sentence make the span quotes
 * come back unmatchable against the source, and a commitment we cannot point back at the document
 * is a commitment the user cannot check.
 */
function tidy(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function parsePdf(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: bytes,
    // No worker in Node, and no network fetches for fonts we are not rendering.
    useWorkerFetch: false,
    useSystemFonts: true,
  }).promise;

  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(
      content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' '),
    );
  }
  return pages.join('\n\n');
}

async function pdfPageCount(bytes: Uint8Array): Promise<number> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes, useWorkerFetch: false }).promise;
  return doc.numPages;
}

async function parseDocx(bytes: Uint8Array): Promise<string> {
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
  return result.value;
}
