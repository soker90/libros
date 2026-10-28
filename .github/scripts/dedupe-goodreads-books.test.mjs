import test from "node:test";
import assert from "node:assert/strict";
import { GOODREADS_DUPLICATE_ISSUES, preferGoodreadsBooks } from "./dedupe-goodreads-books.mjs";

test("prefers Goodreads issues over known legacy duplicates in the API", () => {
  const books = [
    { issueNumber: 3, title: "Yumi y el pintor de pesadillas (edición antigua)" },
    { issueNumber: 77, title: "Yumi y el pintor de pesadillas" },
    { issueNumber: 54, title: "Merlín" },
  ];

  const result = preferGoodreadsBooks(books, "");

  assert.deepEqual(result.books.map((book) => book.issueNumber), [77, 54]);
  assert.deepEqual(result.removedIssueNumbers, [3]);
});

test("removes links to legacy duplicates from the generated README", () => {
  const readme = [
    "[![Yumi antigua](cover.png)](https://github.com/soker90/libros/issues/3 \"old\")",
    "[![Yumi Goodreads](cover.png)](https://github.com/soker90/libros/issues/77 \"goodreads\")",
    "[![Merlín](cover.png)](https://github.com/soker90/libros/issues/54 \"other\")",
  ].join("\n");

  const result = preferGoodreadsBooks([], readme);

  assert.equal(result.readme.includes("/issues/3"), false);
  assert.equal(result.readme.includes("/issues/77"), true);
  assert.equal(result.readme.includes("/issues/54"), true);
});

test("is idempotent and does not remove unrelated books", () => {
  const books = [
    { issueNumber: 76, title: "El hombre iluminado" },
    { issueNumber: 13, title: "El hombre iluminado (edición anterior)" },
    { issueNumber: 88, title: "El pozo de la ascensión" },
  ];
  const first = preferGoodreadsBooks(books, "https://github.com/soker90/libros/issues/13\nkeep");
  const second = preferGoodreadsBooks(first.books, first.readme);

  assert.deepEqual(first.books.map((book) => book.issueNumber), [76, 88]);
  assert.deepEqual(second.books, first.books);
  assert.equal(second.readme, first.readme);
  assert.equal(Object.keys(GOODREADS_DUPLICATE_ISSUES).length, 6);
});
