import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const MONTHS = new Map([
  ["jan", 1], ["january", 1], ["ene", 1], ["enero", 1],
  ["feb", 2], ["february", 2], ["febrero", 2],
  ["mar", 3], ["march", 3], ["marzo", 3],
  ["apr", 4], ["april", 4], ["abr", 4], ["abril", 4],
  ["may", 5], ["mayo", 5],
  ["jun", 6], ["june", 6], ["junio", 6],
  ["jul", 7], ["july", 7], ["julio", 7],
  ["aug", 8], ["august", 8], ["ago", 8], ["agosto", 8],
  ["sep", 9], ["sept", 9], ["september", 9], ["septiembre", 9], ["setiembre", 9],
  ["oct", 10], ["october", 10], ["octubre", 10],
  ["nov", 11], ["november", 11], ["noviembre", 11],
  ["dec", 12], ["december", 12], ["dic", 12], ["diciembre", 12],
]);

function formatDate(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  const date = new Date(Date.UTC(y, m - 1, d));

  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null;
  }

  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Normalize dates only when the source format is unambiguous.
 * Unknown or ambiguous strings are preserved instead of being guessed.
 */
export function normalizePublicationDate(value) {
  if (typeof value !== "string") return value;
  const input = value.trim();
  if (!input) return value;
  if (/^\d{4}$/.test(input)) return input;

  let match = input.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) return formatDate(match[1], match[2], match[3]) || value;

  match = input.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (match) return formatDate(match[1], match[2], match[3]) || value;

  // Numeric day/month/year strings are normalized only when the order is clear.
  match = input.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (match) {
    const first = Number(match[1]);
    const second = Number(match[2]);
    if (first > 12 && second <= 12) return formatDate(match[3], second, first) || value;
    if (second > 12 && first <= 12) return formatDate(match[3], first, second) || value;
    return value;
  }

  // English-style month-first dates, e.g. "Feb 23, 2021" or "February 23 2021".
  match = input.match(/^([A-Za-z.]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (match) {
    const month = MONTHS.get(match[1].replace(/\.$/, "").toLowerCase());
    return month ? formatDate(match[3], month, match[2]) || value : value;
  }

  // Spanish-style dates, e.g. "11 de diciembre de 2025".
  match = input.match(/^(\d{1,2})\s+de\s+([A-Za-záéíóúüñ.]+)\s+(?:de\s+)?(\d{4})$/i);
  if (match) {
    const month = MONTHS.get(match[2].replace(/\.$/, "").toLowerCase());
    return month ? formatDate(match[3], month, match[1]) || value : value;
  }

  return value;
}

export function normalizeBooksPublicationDates(books) {
  let changed = 0;
  const normalizedBooks = books.map((book) => {
    if (typeof book.publishedDate !== "string") return book;
    const publishedDate = normalizePublicationDate(book.publishedDate);
    if (publishedDate === book.publishedDate) return book;
    changed += 1;
    return { ...book, publishedDate };
  });

  return { books: normalizedBooks, changed };
}

async function main() {
  const apiPath = "api.json";
  const source = await readFile(apiPath, "utf8");
  const books = JSON.parse(source);
  const result = normalizeBooksPublicationDates(books);

  if (result.changed > 0) {
    await writeFile(apiPath, `${JSON.stringify(result.books, null, 2)}\n`);
  }

  console.log(`Normalized publication dates for ${result.changed} book(s).`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
