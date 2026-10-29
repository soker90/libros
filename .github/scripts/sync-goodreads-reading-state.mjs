import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const DATE_FIELDS = {
  shelf: /^Goodreads shelf:\s*(.+?)\s*$/im,
  added: /^Date added:\s*(.+?)\s*$/im,
  read: /^Date read:\s*(.+?)\s*$/im,
  id: /^Goodreads ID:\s*(\d+)\s*$/im,
  isbn: /^\s*(?:-\s*)?ISBN(?:-13)?:\s*(978\d{10}|979\d{10})\s*$/im,
  publisher: /^Publisher in Goodreads:\s*(.+?)\s*$/im,
  year: /^Year published in Goodreads:\s*(\d{4})\s*$/im,
  language: /^Language:\s*(.+?)\s*$/im,
  format: /^Format:\s*(.+?)\s*$/im,
  cover: /^Cover URL:\s*(https?:\/\/\S+)\s*$/im,
};

const EDITION_SPECIFIC_FIELDS = [
  "isbn10",
  "description",
  "image",
  "language",
  "averageRating",
  "ratingsCount",
  "categories",
  "pageCount",
  "format",
  "narrator",
  "duration",
  "googleBooks",
  "metadataSource",
  "publisher",
  "publishedDate",
];

function normalizeIsbn13(value) {
  const isbn = value?.replace(/[-\s]/g, "");
  if (!/^97[89]\d{10}$/.test(isbn || "")) return null;

  const checksum = [...isbn.slice(0, 12)].reduce(
    (sum, digit, index) => sum + Number(digit) * (index % 2 === 0 ? 1 : 3),
    0,
  );
  return (10 - (checksum % 10)) % 10 === Number(isbn[12]) ? isbn : null;
}

function parseLanguage(body, labels) {
  const bodyLanguage = body.match(DATE_FIELDS.language)?.[1]?.trim().toLowerCase();
  const labelLanguage = (labels || [])
    .map((label) => typeof label === "string" ? label : label?.name)
    .find((name) => typeof name === "string" && /^language:/i.test(name))
    ?.replace(/^language:\s*/i, "")
    .trim()
    .toLowerCase();
  const value = bodyLanguage || labelLanguage;

  if (["es", "español", "spanish", "castellano"].includes(value)) return "es";
  if (["en", "english", "inglés", "ingles"].includes(value)) return "en";
  return null;
}

function parseGoodreadsDate(value) {
  if (!value || /^(not read yet|n\/a|none)$/i.test(value.trim())) return null;
  const match = value.trim().match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (date.getUTCFullYear() !== Number(y) || date.getUTCMonth() !== Number(m) - 1 || date.getUTCDate() !== Number(d)) return null;
  return date.toISOString();
}

export function formatDuration(durationMs) {
  const seconds = Math.max(0, Math.floor(durationMs / 1000));
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"}`;
  if (days < 30) {
    const weeks = Math.floor(days / 7);
    return `${weeks} week${weeks === 1 ? "" : "s"}`;
  }
  if (days < 365) {
    const months = Math.floor(days / 30);
    return `${months} month${months === 1 ? "" : "s"}`;
  }

  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? "" : "s"}`;
}

export function parseGoodreadsReadingData(body, labels = []) {
  if (typeof body !== "string") return null;
  const get = (regex) => body.match(regex)?.[1]?.trim() ?? null;
  const goodreadsId = get(DATE_FIELDS.id);
  const shelf = get(DATE_FIELDS.shelf)?.toLowerCase();
  if (!goodreadsId || !["read", "currently-reading", "to-read"].includes(shelf)) return null;

  const completedAt = shelf === "read" ? parseGoodreadsDate(get(DATE_FIELDS.read)) : null;
  const addedAt = parseGoodreadsDate(get(DATE_FIELDS.added));
  // Goodreads Date Added is only a proxy for reading start. If it comes after
  // Date Read, use Date Read as the start rather than creating a negative span.
  const startedAt = completedAt && addedAt && addedAt > completedAt ? completedAt : addedAt;

  return {
    shelf,
    startedAt,
    completedAt,
    isbn13: normalizeIsbn13(get(DATE_FIELDS.isbn)),
    publisher: get(DATE_FIELDS.publisher),
    publishedDate: get(DATE_FIELDS.year),
    language: parseLanguage(body, labels),
    format: get(DATE_FIELDS.format),
    cover: get(DATE_FIELDS.cover),
  };
}

export function applyGoodreadsReadingData(books, issues) {
  const dataByIssue = new Map();
  for (const issue of issues) {
    if (!issue || issue.pull_request || !Number.isInteger(issue.number)) continue;
    const data = parseGoodreadsReadingData(issue.body, issue.labels);
    if (data) dataByIssue.set(issue.number, data);
  }

  let updated = 0;
  const result = books.map((book) => {
    const data = dataByIssue.get(Number(book.issueNumber));
    if (!data) return book;

    const next = { ...book };
    const isbnChanged = Boolean(data.isbn13 && book.isbn13 && data.isbn13 !== book.isbn13);

    // An ISBN in the source issue identifies the intended edition. Never keep
    // edition-specific data fetched for a different ISBN.
    if (isbnChanged) {
      for (const field of EDITION_SPECIFIC_FIELDS) delete next[field];
      next.metadataSource = "Goodreads ISBN from source issue; edition metadata needs verification";
    }

    if (data.isbn13) {
      next.isbn13 = data.isbn13;
      next.requestedIsbn = data.isbn13;
    }

    next.state = data.shelf === "read" ? "completed"
      : data.shelf === "currently-reading" ? "reading"
      : "want-to-read";

    if (data.startedAt) next.startedAt = data.startedAt;
    else delete next.startedAt;

    if (data.completedAt) next.completedAt = data.completedAt;
    else delete next.completedAt;

    if (data.startedAt && data.completedAt) {
      next.timeToComplete = Date.parse(data.completedAt) - Date.parse(data.startedAt);
      next.timeToCompleteFormatted = formatDuration(next.timeToComplete);
    } else {
      delete next.timeToComplete;
      delete next.timeToCompleteFormatted;
    }

    // Only overwrite edition fields with values explicitly recorded in the issue.
    if (data.publisher) next.publisher = data.publisher;
    if (data.publishedDate) next.publishedDate = data.publishedDate;
    if (data.language) next.language = data.language;
    if (data.format) next.format = data.format;
    if (data.cover) next.image = data.cover;

    updated += 1;
    return next;
  });

  return { books: result, updated };
}

async function fetchAllIssues(repository, token) {
  const issues = [];
  for (let page = 1; ; page += 1) {
    const url = `https://api.github.com/repos/${repository}/issues?state=all&per_page=100&page=${page}`;
    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!response.ok) throw new Error(`Failed to fetch issues (HTTP ${response.status}): ${await response.text()}`);
    const batch = await response.json();
    issues.push(...batch);
    if (batch.length < 100) return issues;
  }
}

async function main() {
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repository || !token) throw new Error("GITHUB_REPOSITORY and GITHUB_TOKEN are required.");

  const [source, issues] = await Promise.all([
    readFile("api.json", "utf8"),
    fetchAllIssues(repository, token),
  ]);
  const books = JSON.parse(source);
  const result = applyGoodreadsReadingData(books, issues);
  if (result.updated > 0) {
    await writeFile("api.json", `${JSON.stringify(result.books, null, 2)}\n`);
  }
  console.log(`Synced Goodreads status, dates, ISBNs, explicit edition metadata, and cover URLs for ${result.updated} book(s) from issue metadata.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
