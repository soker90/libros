import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const DATE_FIELDS = {
  shelf: /^Goodreads shelf:\s*(.+?)\s*$/im,
  added: /^Date added:\s*(.+?)\s*$/im,
  started: /^Date started:\s*(.+?)\s*$/im,
  read: /^Date read:\s*(.+?)\s*$/im,
  id: /^Goodreads ID:\s*(\d+)\s*$/im,
  goodreadsRating: /^Goodreads rating:\s*(\d+(?:[.,]\d+)?)\s*\/\s*5\s*$/im,
  personalRating: /^Personal rating:\s*(\d+(?:[.,]\d+)?)\s*\/\s*5\s*$/im,
  isbn: /^\s*(?:-\s*)?ISBN(?:-13)?:\s*(978\d{10}|979\d{10})\s*$/im,
  publisher: /^Publisher in Goodreads:\s*(.+?)\s*$/im,
  year: /^Year published in Goodreads:\s*(\d{4})\s*$/im,
  verifiedPublisher: /^Verified publisher:\s*(.+?)\s*$/im,
  verifiedTitle: /^Verified title:\s*(.+?)\s*$/im,
  verifiedPublicationDate: /^Verified publication date:\s*(\d{4}(?:-\d{2}-\d{2})?)\s*$/im,
  verifiedFormat: /^Verified format:\s*(.+?)\s*$/im,
  verifiedPageCount: /^Verified page count:\s*(\d+)\s*$/im,
  verifiedDescription: /^Verified description:\s*(.+?)\s*$/im,
  description: /^Description:\s*(.+?)\s*$/im,
  verifiedCategories: /^Verified categories:\s*(.+?)\s*$/im,
  categories: /^Categories:\s*(.+?)\s*$/im,
  verifiedSource: /^Verified source:\s*(https?:\/\/\S+)\s*$/im,
  language: /^Language:\s*(.+?)\s*$/im,
  format: /^Format:\s*(.+?)\s*$/im,
  cover: /^Cover URL:\s*(https?:\/\/\S+)\s*$/im,
  verifiedCover: /^Verified cover URL:\s*(https?:\/\/\S+)\s*$/im,
};

// These corrections were explicitly confirmed by the user because the imported
// Goodreads shelves are stale. Keep them as source-side overrides; api.json is generated.
const USER_CONFIRMED_STATE_OVERRIDES = new Map([
  [126, "completed"],
  [127, "completed"],
  [129, "completed"],
  [131, "completed"],
  [132, "completed"],
  [133, "completed"],
  [134, "completed"],
  [135, "completed"],
  [136, "completed"],
  [137, "completed"],
  [138, "completed"],
  [139, "want-to-read"],
]);

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
  const parseRating = (value) => {
    if (!value) return null;
    const rating = Number(value.replace(",", "."));
    return Number.isFinite(rating) && rating >= 0 && rating <= 5 ? rating : null;
  };
  const goodreadsId = get(DATE_FIELDS.id);
  const shelf = get(DATE_FIELDS.shelf)?.toLowerCase();
  if (!goodreadsId || (shelf && !["read", "currently-reading", "to-read"].includes(shelf))) return null;

  const dateRead = parseGoodreadsDate(get(DATE_FIELDS.read));
  const completedAt = shelf === "read" || (!shelf && dateRead) ? dateRead : null;
  // Date Added records when a book entered the Goodreads library, not when
  // reading began. Only an explicit Date Started may populate startedAt.
  const startedAt = parseGoodreadsDate(get(DATE_FIELDS.started));
  const verifiedTitle = get(DATE_FIELDS.verifiedTitle);
  const categories = get(DATE_FIELDS.verifiedCategories) || get(DATE_FIELDS.categories);
  const verifiedSource = get(DATE_FIELDS.verifiedSource);

  const data = {
    shelf,
    ...(parseRating(get(DATE_FIELDS.goodreadsRating)) !== null ? { goodreadsRating: parseRating(get(DATE_FIELDS.goodreadsRating)) } : {}),
    ...(parseRating(get(DATE_FIELDS.personalRating)) !== null ? { personalRating: parseRating(get(DATE_FIELDS.personalRating)) } : {}),
    startedAt,
    completedAt,
    dateRead,
    isbn13: normalizeIsbn13(get(DATE_FIELDS.isbn)),
    publisher: get(DATE_FIELDS.verifiedPublisher) || get(DATE_FIELDS.publisher),
    publishedDate: get(DATE_FIELDS.verifiedPublicationDate) || get(DATE_FIELDS.year),
    language: parseLanguage(body, labels),
    format: get(DATE_FIELDS.verifiedFormat) || get(DATE_FIELDS.format),
    cover: get(DATE_FIELDS.verifiedCover) || get(DATE_FIELDS.cover),
    description: get(DATE_FIELDS.verifiedDescription) || get(DATE_FIELDS.description),
    pageCount: Number(get(DATE_FIELDS.verifiedPageCount)) || null,
    categories: categories ? categories.split(/[;,]/).map((category) => category.trim()).filter(Boolean) : null,
    verified: Boolean(verifiedSource),
  };
  if (verifiedTitle) data.title = verifiedTitle;
  return data;
}

export function applyGoodreadsReadingData(books, issues) {
  const dataByIssue = new Map();
  for (const issue of issues) {
    if (!issue || issue.pull_request || !Number.isInteger(issue.number)) continue;
    const data = parseGoodreadsReadingData(issue.body, issue.labels);
    if (data) dataByIssue.set(issue.number, { data, issue });
  }

  let updated = 0;
  const result = books.map((book) => {
    const source = dataByIssue.get(Number(book.issueNumber));
    const data = source?.data;
    const sourceIssue = source?.issue;
    const confirmedState = USER_CONFIRMED_STATE_OVERRIDES.get(Number(book.issueNumber));
    if (!data) {
      if (!confirmedState || book.state === confirmedState) return book;
      updated += 1;
      return { ...book, state: confirmedState };
    }

    const next = { ...book };
    const isbnChanged = Boolean(data.isbn13 && book.isbn13 && data.isbn13 !== book.isbn13);

    // An ISBN in the source issue identifies the intended edition. Never keep
    // edition-specific data fetched for a different ISBN.
    if (isbnChanged) {
      for (const field of EDITION_SPECIFIC_FIELDS) delete next[field];
      next.metadataSource = data.verified
        ? "Exact ISBN match; edition metadata verified against ISBN-specific catalogue sources"
        : "Goodreads ISBN from source issue; edition metadata needs verification";
    }

    if (data.isbn13) {
      next.isbn13 = data.isbn13;
      next.requestedIsbn = data.isbn13;
    }
    if (data.title) next.title = data.title;

    next.state = confirmedState || (data.shelf === "read" ? "completed"
      : data.shelf === "currently-reading" ? "reading"
      : data.shelf === "to-read" ? "want-to-read"
      : book.state);

    if (data.goodreadsRating !== undefined) next.goodreadsRating = data.goodreadsRating;
    else if (data.shelf) delete next.goodreadsRating;
    if (data.personalRating !== undefined) next.personalRating = data.personalRating;

    const closedAtDay = sourceIssue?.closed_at?.slice(0, 10);
    const generatedStartDate = confirmedState === "completed"
      && !data.startedAt
      && closedAtDay
      && book.startedAt?.slice(0, 10) === closedAtDay;
    const generatedCompletionDate = confirmedState === "completed"
      && !data.dateRead
      && closedAtDay
      && book.completedAt?.slice(0, 10) === closedAtDay;

    if (data.startedAt) next.startedAt = data.startedAt;
    else if (data.shelf || data.dateRead || confirmedState || generatedStartDate) delete next.startedAt;

    const completedAt = data.dateRead
      && (confirmedState === "completed" || data.shelf === "read" || (!data.shelf && book.state === "completed"))
      ? data.dateRead
      : confirmedState === "completed"
        ? data.dateRead || data.completedAt
        : data.completedAt;
    if (completedAt) next.completedAt = completedAt;
    else if (data.shelf || generatedCompletionDate) delete next.completedAt;

    if (generatedCompletionDate) delete next.completedAt;
    if (generatedStartDate) delete next.startedAt;

    if (next.startedAt && next.completedAt && (data.startedAt || completedAt || generatedStartDate || generatedCompletionDate)) {
      next.timeToComplete = Date.parse(next.completedAt) - Date.parse(next.startedAt);
      next.timeToCompleteFormatted = formatDuration(next.timeToComplete);
    } else if (generatedStartDate || generatedCompletionDate || data.startedAt || completedAt) {
      delete next.timeToComplete;
      delete next.timeToCompleteFormatted;
    }

    // Only overwrite edition fields with values explicitly recorded in the issue.
    if (data.publisher) next.publisher = data.publisher;
    if (data.publishedDate) next.publishedDate = data.publishedDate;
    if (data.language) next.language = data.language;
    if (data.format) next.format = data.format;
    if (data.cover) next.image = data.cover;
    if (data.description) next.description = data.description;
    if (data.pageCount) next.pageCount = data.pageCount;
    if (data.categories?.length) next.categories = data.categories;
    if (data.verified) next.metadataSource = "Exact ISBN match; edition metadata verified against ISBN-specific catalogue sources";

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
  console.log(`Synced Goodreads status, dates, ISBNs, and explicitly verified edition metadata for ${result.updated} book(s) from issue metadata.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
