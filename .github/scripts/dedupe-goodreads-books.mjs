import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

/**
 * When the Goodreads import duplicates a book already in the catalogue,
 * prefer the Goodreads issue and hide the older catalogue entry.
 *
 * Keys are legacy issue numbers; values are the Goodreads-imported issue
 * numbers that replace them. This explicit map avoids hiding different
 * books merely because their titles are similar.
 */
export const GOODREADS_DUPLICATE_ISSUES = Object.freeze({
  3: 77,  // Yumi y el pintor de pesadillas
  1: 78,  // El ritmo de la guerra
  4: 81,  // Juramentada
  13: 76, // El hombre iluminado
  38: 83, // Words of Radiance / Palabras radiantes
  41: 74, // Assassin's Apprentice / Aprendiz de asesino
});

const duplicateIssueNumbers = new Set(Object.keys(GOODREADS_DUPLICATE_ISSUES).map(Number));

function isLegacyDuplicateLink(line) {
  return [...duplicateIssueNumbers].some((issueNumber) =>
    new RegExp(`github\\.com/soker90/libros/issues/${issueNumber}(?:\\D|$)`).test(line),
  );
}

/** Remove legacy duplicate records from the public API and generated README. */
export function preferGoodreadsBooks(books, readme) {
  const filteredBooks = books.filter((book) => !duplicateIssueNumbers.has(Number(book.issueNumber)));
  const filteredReadme = readme
    .split("\n")
    .filter((line) => !isLegacyDuplicateLink(line))
    .join("\n");

  return {
    books: filteredBooks,
    readme: filteredReadme,
    removedIssueNumbers: books
      .filter((book) => duplicateIssueNumbers.has(Number(book.issueNumber)))
      .map((book) => Number(book.issueNumber)),
  };
}

async function main() {
  const apiPath = "api.json";
  const readmePath = "README.md";
  const books = JSON.parse(await readFile(apiPath, "utf8"));
  const readme = await readFile(readmePath, "utf8");
  const result = preferGoodreadsBooks(books, readme);

  if (result.books.length !== books.length) {
    await writeFile(apiPath, `${JSON.stringify(result.books, null, 2)}\n`);
  }
  if (result.readme !== readme) {
    await writeFile(readmePath, result.readme);
  }

  if (result.removedIssueNumbers.length) {
    console.log(`Hidden legacy duplicates in favour of Goodreads: ${result.removedIssueNumbers.join(", ")}`);
  } else {
    console.log("No legacy Goodreads duplicates to remove.");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
