import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const API_URL = "https://api.github.com";
const REVIEW_PREFIX = /^Reseña externa:\s*(.+?)\s*$/im;
const ALLOWED_SOURCES = new Map([
  ["biblioteca de nehemias", "Biblioteca de Nehemías"],
  ["la biblioteca de nehemias", "Biblioteca de Nehemías"],
  ["de libros", "De libros"],
  ["el club del lector", "El Club del Lector"],
  ["aceprensa", "Aceprensa"],
  ["hacer familia", "Hacer Familia"],
  ["delibris", "Delibris"],
]);

function normalizeSource(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("es");
}

export function parseExternalReviews(comments = []) {
  const reviews = new Map();

  for (const comment of comments) {
    const body = typeof comment?.body === "string" ? comment.body : "";
    const match = body.match(REVIEW_PREFIX);
    if (!match) continue;

    const sourceLabel = match[1].split(/\s+[—–-]\s+/)[0].replace(/\s*\([^)]*\)\s*$/, "").trim();
    const source = ALLOWED_SOURCES.get(normalizeSource(sourceLabel));
    if (!source) continue;

    const urls = [...body.matchAll(/https?:\/\/[^\s<>]+/gi)]
      .map(([url]) => url.replace(/[),.;]+$/, ""))
      .filter((url) => {
        try {
          const parsed = new URL(url);
          return ["http:", "https:"].includes(parsed.protocol);
        } catch {
          return false;
        }
      });

    for (const url of urls) {
      if (!reviews.has(url)) reviews.set(url, { source, title: source, url });
    }
  }

  return [...reviews.values()];
}

export function parseCollections(comments = [], labels = [], issueBody = "") {
  const collections = new Set();

  for (const label of labels) {
    const name = (typeof label === "string" ? label : label?.name || "").trim();
    if (name.toLowerCase().startsWith("collection:")) {
      const value = name.slice("collection:".length).trim();
      if (value) collections.add(value);
    }
  }

  for (const body of [...comments.map((comment) => typeof comment?.body === "string" ? comment.body : ""), issueBody]) {
    for (const match of body.matchAll(/^Colección:\s*(.+?)\s*$/gim)) {
      const value = match[1].trim();
      if (value) collections.add(value);
    }
  }

  return [...collections];
}

export function applyExternalReviews(books, issueNumber, comments, labels = [], issueBody = "") {
  if (!Array.isArray(books)) throw new TypeError("The API data must be an array of books.");
  const number = Number(issueNumber);
  if (!Number.isInteger(number) || number < 1) throw new TypeError("The issue number must be a positive integer.");

  const externalReviews = parseExternalReviews(comments);
  const collections = parseCollections(comments, labels, issueBody);
  let updated = false;
  const result = books.map((book) => {
    if (Number(book.issueNumber) !== number) return book;
    updated = true;
    const next = { ...book };
    if (externalReviews.length) next.externalReviews = externalReviews;
    else delete next.externalReviews;
    if (collections.length) next.collections = collections;
    else delete next.collections;
    return next;
  });

  return { books: result, updated, externalReviews };
}

async function fetchIssueDetails({ token, repository, issueNumber }) {
  const response = await fetch(`${API_URL}/repos/${repository}/issues/${issueNumber}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${await response.text()}`);
  return response.json();
}

async function fetchIssueComments({ token, repository, issueNumber }) {
  const comments = [];
  for (let page = 1; ; page += 1) {
    const response = await fetch(
      `${API_URL}/repos/${repository}/issues/${issueNumber}/comments?per_page=100&page=${page}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );
    if (!response.ok) throw new Error(`GitHub API ${response.status}: ${await response.text()}`);
    const pageComments = await response.json();
    comments.push(...pageComments);
    if (pageComments.length < 100) return comments;
  }
}

async function main() {
  const { GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_EVENT_PATH } = process.env;
  if (!GITHUB_TOKEN || !GITHUB_REPOSITORY || !GITHUB_EVENT_PATH) {
    throw new Error("GITHUB_TOKEN, GITHUB_REPOSITORY and GITHUB_EVENT_PATH are required.");
  }

  const event = JSON.parse(await readFile(GITHUB_EVENT_PATH, "utf8"));
  const apiPath = "api.json";
  const books = JSON.parse(await readFile(apiPath, "utf8"));
  const issueNumber = Number(event.issue?.number);

  if (Number.isInteger(issueNumber) && issueNumber > 0) {
    const details = event.issue?.labels ? event.issue : await fetchIssueDetails({ token: GITHUB_TOKEN, repository: GITHUB_REPOSITORY, issueNumber });
    const comments = await fetchIssueComments({ token: GITHUB_TOKEN, repository: GITHUB_REPOSITORY, issueNumber });
    const result = applyExternalReviews(books, issueNumber, comments, details.labels || [], details.body || "");
    if (!result.updated) {
      console.warn(`No API entry found for issue #${issueNumber}; external reviews were not changed.`);
      return;
    }
    await writeFile(apiPath, `${JSON.stringify(result.books, null, 2)}\n`);
    console.log(`Synced ${result.externalReviews.length} external review(s) for issue #${issueNumber}.`);
    return;
  }

  // On a workflow push, backfill comments already present before this sync was introduced.
  let updatedBooks = books;
  for (const book of books) {
    if (!Number.isInteger(book.issueNumber) || book.issueNumber < 1) continue;
    const details = await fetchIssueDetails({ token: GITHUB_TOKEN, repository: GITHUB_REPOSITORY, issueNumber: book.issueNumber });
    const comments = await fetchIssueComments({
      token: GITHUB_TOKEN,
      repository: GITHUB_REPOSITORY,
      issueNumber: book.issueNumber,
    });
    updatedBooks = applyExternalReviews(updatedBooks, book.issueNumber, comments, details.labels || [], details.body || "").books;
  }
  await writeFile(apiPath, `${JSON.stringify(updatedBooks, null, 2)}\n`);
  console.log(`Backfilled external reviews for ${updatedBooks.filter((book) => Array.isArray(book.externalReviews)).length} books.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
