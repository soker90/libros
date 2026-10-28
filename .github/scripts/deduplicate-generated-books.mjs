import { readFile, writeFile } from "node:fs/promises";

const GOODREADS_ID = /^Goodreads ID:\s*(\d+)\s*$/im;

export function getGoodreadsId(issue) {
  return typeof issue?.body === "string"
    ? issue.body.match(GOODREADS_ID)?.[1] ?? null
    : null;
}

/** Prefer the issue that preserves the most Goodreads and edition metadata. */
export function scoreCanonicalIssue(issue) {
  const body = typeof issue?.body === "string" ? issue.body : "";
  const labels = (issue?.labels || []).map((label) =>
    typeof label === "string" ? label : label?.name || "",
  );

  return Number(Boolean(body.match(/^Format:\s*.+$/im))) * 3
    + Number(/identify this exact edition/i.test(body)) * 2
    + Number(Boolean(body.match(/^ISBN:\s*.+$/im)))
    + Number(Boolean(body.match(/^Goodreads title:\s*.+$/im)))
    + Number(Boolean(body.match(/^Date added:\s*.+$/im)))
    + Number(Boolean(body.match(/^Date read:\s*.+$/im)))
    + Number(/Goodreads status synced from export:/i.test(body))
    + Number(labels.includes("kind: book")) * 2
    + Math.min(labels.length, 30) / 100;
}

/**
 * Remove generated API entries that point to the same Goodreads record.
 * Different Goodreads IDs are intentionally kept separate, even if title or
 * ISBN coincide, so edition differences are never guessed away.
 */
export function deduplicateGeneratedBooks(books, issues) {
  const candidatesByGoodreadsId = new Map();

  for (const issue of issues) {
    if (!issue || issue.pull_request || !Number.isInteger(issue.number)) continue;
    const id = getGoodreadsId(issue);
    if (!id) continue;

    const candidates = candidatesByGoodreadsId.get(id) || [];
    candidates.push(issue);
    candidatesByGoodreadsId.set(id, candidates);
  }

  const canonicalIssueNumbers = new Set();
  const duplicates = [];

  for (const [goodreadsId, candidates] of candidatesByGoodreadsId) {
    const ranked = candidates.toSorted((a, b) =>
      scoreCanonicalIssue(b) - scoreCanonicalIssue(a) || a.number - b.number,
    );
    canonicalIssueNumbers.add(ranked[0].number);

    for (const duplicate of ranked.slice(1)) {
      duplicates.push({
        goodreadsId,
        duplicateIssueNumber: duplicate.number,
        canonicalIssueNumber: ranked[0].number,
      });
    }
  }

  const seenGoodreadsIds = new Set();
  const duplicateIssueNumbers = new Set(duplicates.map((item) => item.duplicateIssueNumber));
  const result = books.filter((book) => {
    const issueNumber = Number(book.issueNumber);
    if (!duplicateIssueNumbers.has(issueNumber)) return true;
    return false;
  });

  return {
    books: result,
    duplicates: duplicates.filter((item) =>
      books.some((book) => Number(book.issueNumber) === item.duplicateIssueNumber),
    ),
  };
}

async function fetchAllIssues(repository, token) {
  const issues = [];
  for (let page = 1; ; page += 1) {
    const response = await fetch(
      `https://api.github.com/repos/${repository}/issues?state=all&per_page=100&page=${page}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!response.ok) {
      throw new Error(`Failed to fetch issues (HTTP ${response.status}): ${await response.text()}`);
    }

    const batch = await response.json();
    issues.push(...batch);
    if (batch.length < 100) return issues;
  }
}

async function main() {
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repository || !token) {
    throw new Error("GITHUB_REPOSITORY and GITHUB_TOKEN are required.");
  }

  const [source, issues] = await Promise.all([
    readFile("api.json", "utf8"),
    fetchAllIssues(repository, token),
  ]);
  const result = deduplicateGeneratedBooks(JSON.parse(source), issues);

  if (result.books.length !== JSON.parse(source).length) {
    await writeFile("api.json", `${JSON.stringify(result.books, null, 2)}\n`);
  }

  for (const duplicate of result.duplicates) {
    console.log(
      `Removed duplicate Goodreads entry for issue #${duplicate.duplicateIssueNumber}; `
      + `keeping issue #${duplicate.canonicalIssueNumber} (Goodreads ID ${duplicate.goodreadsId}).`,
    );
  }
  console.log(`Catalog deduplication complete: removed ${result.duplicates.length} duplicate API entry/entries.`);
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
