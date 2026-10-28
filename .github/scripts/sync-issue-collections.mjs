import { readFile, writeFile } from "node:fs/promises";

const COLLECTION_LABEL_PREFIX = "collection:";

export function applyIssueCollections(books, issue) {
  if (!Array.isArray(books)) {
    throw new TypeError("The API data must be an array of books.");
  }

  const issueNumber = Number(issue?.number);
  if (!Number.isInteger(issueNumber) || issueNumber < 1) {
    throw new TypeError("The issue must have a valid number.");
  }

  const collections = [...new Set(
    (issue.labels || [])
      .map((label) => typeof label === "string" ? label : label?.name)
      .filter((name) => typeof name === "string")
      .map((name) => name.trim())
      .filter((name) => name.toLowerCase().startsWith(COLLECTION_LABEL_PREFIX))
      .map((name) => name.slice(COLLECTION_LABEL_PREFIX.length).trim())
      .filter(Boolean),
  )];

  let updated = false;
  const result = books.map((book) => {
    if (Number(book.issueNumber) !== issueNumber) return book;

    const next = { ...book };
    if (collections.length) {
      next.collections = collections;
    } else {
      delete next.collections;
    }

    updated = true;
    return next;
  });

  return { books: result, updated, collections };
}

async function main() {
  const { GITHUB_EVENT_PATH } = process.env;
  if (!GITHUB_EVENT_PATH) {
    throw new Error("GITHUB_EVENT_PATH is required.");
  }

  const event = JSON.parse(await readFile(GITHUB_EVENT_PATH, "utf8"));
  if (!event.issue?.number) {
    throw new Error("This workflow did not receive an issue event.");
  }

  const apiPath = "api.json";
  const books = JSON.parse(await readFile(apiPath, "utf8"));
  const result = applyIssueCollections(books, event.issue);

  if (!result.updated) {
    console.warn(`No API entry found for issue #${event.issue.number}; collection metadata was not changed.`);
    return;
  }

  await writeFile(apiPath, `${JSON.stringify(result.books, null, 2)}\n`);
  console.log(
    result.collections.length
      ? `Synced collections for issue #${event.issue.number}: ${result.collections.join(", ")}`
      : `Removed collection metadata for issue #${event.issue.number}`,
  );
}

if (process.env.GITHUB_EVENT_PATH) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
