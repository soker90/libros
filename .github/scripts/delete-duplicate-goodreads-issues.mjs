import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { getGoodreadsId, scoreCanonicalIssue } from "./deduplicate-generated-books.mjs";

const GRAPHQL_URL = "https://api.github.com/graphql";
const ISSUES_URL = (repository, page) =>
  `https://api.github.com/repos/${repository}/issues?state=all&per_page=100&page=${page}`;

export function findDuplicateGoodreadsIssues(books, issues) {
  if (!Array.isArray(books) || !Array.isArray(issues)) {
    throw new TypeError("Books and issues must be arrays.");
  }

  const generatedIssueNumbers = new Set(
    books.map((book) => Number(book.issueNumber)).filter(Number.isInteger),
  );
  const issuesByGoodreadsId = new Map();

  for (const issue of issues) {
    if (!issue || issue.pull_request || !Number.isInteger(issue.number)) continue;
    const goodreadsId = getGoodreadsId(issue);
    if (!goodreadsId) continue;

    const group = issuesByGoodreadsId.get(goodreadsId) || [];
    group.push(issue);
    issuesByGoodreadsId.set(goodreadsId, group);
  }

  const duplicates = [];
  for (const [goodreadsId, candidates] of issuesByGoodreadsId) {
    if (candidates.length < 2) continue;

    const ranked = candidates.toSorted((a, b) =>
      scoreCanonicalIssue(b) - scoreCanonicalIssue(a) || a.number - b.number,
    );
    const canonical = ranked[0];

    // Only delete duplicates when the canonical issue is present in the
    // generated catalogue. This prevents deleting a group with no live entry.
    if (!generatedIssueNumbers.has(canonical.number)) continue;

    for (const duplicate of ranked.slice(1)) {
      if (!duplicate.node_id) {
        throw new Error(`Issue #${duplicate.number} has no GraphQL node ID.`);
      }
      duplicates.push({
        goodreadsId,
        duplicateIssueNumber: duplicate.number,
        duplicateNodeId: duplicate.node_id,
        canonicalIssueNumber: canonical.number,
      });
    }
  }

  return duplicates;
}

async function fetchAllIssues(repository, token) {
  const issues = [];
  for (let page = 1; ; page += 1) {
    const response = await fetch(ISSUES_URL(repository, page), {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch issues (HTTP ${response.status}): ${await response.text()}`);
    }

    const batch = await response.json();
    issues.push(...batch);
    if (batch.length < 100) return issues;
  }
}

async function deleteIssue(issueId, token) {
  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: `mutation DeleteDuplicateGoodreadsIssue($issueId: ID!) {
        deleteIssue(input: { issueId: $issueId }) {
          repository { id }
        }
      }`,
      variables: { issueId },
    }),
    signal: AbortSignal.timeout(20_000),
  });

  const result = await response.json();
  if (!response.ok || result.errors?.length || !result.data?.deleteIssue) {
    throw new Error(
      `Failed to delete duplicate issue (HTTP ${response.status}): ${JSON.stringify(result.errors || result)}`,
    );
  }
}

async function main() {
  const repository = process.env.GITHUB_REPOSITORY;
  const readToken = process.env.GITHUB_TOKEN;
  const deleteToken = process.env.LIBROS_ADMIN_TOKEN;
  if (!repository || !readToken) {
    throw new Error("GITHUB_REPOSITORY and GITHUB_TOKEN are required.");
  }

  const books = JSON.parse(await readFile("api.json", "utf8"));
  const issues = await fetchAllIssues(repository, readToken);
  const duplicates = findDuplicateGoodreadsIssues(books, issues);

  if (!duplicates.length) {
    console.log("No confirmed duplicate Goodreads issues to delete.");
    return;
  }

  if (!deleteToken) {
    console.warn(
      `Found ${duplicates.length} confirmed duplicate Goodreads issue(s), but deletion was skipped. `
      + "Configure the LIBROS_ADMIN_TOKEN repository secret with permission to delete issues.",
    );
    for (const duplicate of duplicates) {
      console.warn(
        `Pending deletion: issue #${duplicate.duplicateIssueNumber}; `
        + `keep #${duplicate.canonicalIssueNumber} (Goodreads ID ${duplicate.goodreadsId}).`,
      );
    }
    return;
  }

  for (const duplicate of duplicates) {
    await deleteIssue(duplicate.duplicateNodeId, deleteToken);
    console.log(
      `Deleted duplicate issue #${duplicate.duplicateIssueNumber}; `
      + `kept #${duplicate.canonicalIssueNumber} (Goodreads ID ${duplicate.goodreadsId}).`,
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
