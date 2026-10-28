import test from "node:test";
import assert from "node:assert/strict";
import { deduplicateGeneratedBooks, getGoodreadsId } from "./deduplicate-generated-books.mjs";

test("identifies the Goodreads record stored in an issue", () => {
  assert.equal(getGoodreadsId({ body: "Author: Example\nGoodreads ID: 12345\n" }), "12345");
  assert.equal(getGoodreadsId({ body: "No Goodreads ID here" }), null);
});

test("keeps the richest issue for a duplicated Goodreads ID", () => {
  const issues = [
    { number: 46, body: "Author: Robin Hobb\nGoodreads ID: 230787090\nISBN: 9788419680976\nGoodreads title: La búsqueda del asesino\nDate added: 2025/12/08\nDate read: 2025/12/31\nGoodreads status synced from export: 2026-10-28.", labels: [{ name: "kind: book" }] },
    { number: 72, body: "Author: Robin Hobb\nGoodreads ID: 230787090\nISBN: 9788419680976\nGoodreads title: La búsqueda del asesino\nDate added: 2025/12/08\nDate read: 2025/12/31\nFormat: Tapa blanda\nImported from Goodreads. Keep the Goodreads ID and ISBN to identify this exact edition.\nGoodreads status synced from export: 2026-10-28.", labels: [{ name: "kind: book" }] },
  ];
  const books = [{ issueNumber: 46 }, { issueNumber: 72 }, { issueNumber: 99 }];
  const result = deduplicateGeneratedBooks(books, issues);

  assert.deepEqual(result.books, [{ issueNumber: 72 }, { issueNumber: 99 }]);
  assert.deepEqual(result.duplicates, [
    { goodreadsId: "230787090", duplicateIssueNumber: 46, canonicalIssueNumber: 72 },
  ]);
});

test("does not merge distinct Goodreads records just because ISBNs match", () => {
  const issues = [
    { number: 10, body: "Goodreads ID: 100\nISBN: 9788466658904", labels: [] },
    { number: 11, body: "Goodreads ID: 200\nISBN: 9788466658904", labels: [] },
  ];
  const books = [{ issueNumber: 10 }, { issueNumber: 11 }];
  const result = deduplicateGeneratedBooks(books, issues);

  assert.deepEqual(result.books, books);
  assert.deepEqual(result.duplicates, []);
});

test("does not remove entries when a duplicate issue is absent from the generated API", () => {
  const issues = [
    { number: 88, body: "Goodreads ID: 55300645\nFormat: Tapa dura", labels: [{ name: "kind: book" }] },
    { number: 89, body: "Goodreads ID: 55300645", labels: [] },
  ];
  const books = [{ issueNumber: 88 }];
  const result = deduplicateGeneratedBooks(books, issues);

  assert.deepEqual(result.books, books);
  assert.deepEqual(result.duplicates, []);
});
