import { readFile, writeFile } from "node:fs/promises";

const DATE_FIELDS = {
  shelf: /^Goodreads shelf:\s*(.+?)\s*$/im,
  added: /^Date added:\s*(.+?)\s*$/im,
  read: /^Date read:\s*(.+?)\s*$/im,
  id: /^Goodreads ID:\s*(\d+)\s*$/im,
};

function parseGoodreadsDate(value) {
  if (!value || /^(not read yet|n\/a|none)$/i.test(value.trim())) return null;
  const match = value.trim().match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (date.getUTCFullYear() !== Number(y) || date.getUTCMonth() !== Number(m) - 1 || date.getUTCDate() !== Number(d)) return null;
  return date.toISOString();
}

export function parseGoodreadsReadingData(body) {
  if (typeof body !== "string") return null;
  const get = (regex) => body.match(regex)?.[1]?.trim() ?? null;
  const goodreadsId = get(DATE_FIELDS.id);
  const shelf = get(DATE_FIELDS.shelf)?.toLowerCase();
  if (!goodreadsId || !["read", "currently-reading", "to-read"].includes(shelf)) return null;

  return {
    shelf,
    startedAt: parseGoodreadsDate(get(DATE_FIELDS.added)),
    completedAt: shelf === "read" ? parseGoodreadsDate(get(DATE_FIELDS.read)) : null,
  };
}

export function applyGoodreadsReadingData(books, issues) {
  const dataByIssue = new Map();
  for (const issue of issues) {
    if (!issue || issue.pull_request || !Number.isInteger(issue.number)) continue;
    const data = parseGoodreadsReadingData(issue.body);
    if (data) dataByIssue.set(issue.number, data);
  }

  let updated = 0;
  const result = books.map((book) => {
    const data = dataByIssue.get(Number(book.issueNumber));
    if (!data) return book;

    const next = { ...book };
    next.state = data.shelf === "read" ? "completed"
      : data.shelf === "currently-reading" ? "reading"
      : "want-to-read";

    if (data.startedAt) next.startedAt = data.startedAt;
    else delete next.startedAt;

    if (data.completedAt) next.completedAt = data.completedAt;
    else delete next.completedAt;

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
  console.log(`Synced Goodreads status and dates for ${result.updated} book(s) from issue metadata.`);
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
