import test from "node:test";
import assert from "node:assert/strict";
import { applyIssueCollections } from "./sync-issue-collections.mjs";

test("copies collection labels into the matching API book", () => {
  const books = [
    { issueNumber: 12, title: "A book" },
    { issueNumber: 13, title: "Another book" },
  ];

  const result = applyIssueCollections(books, {
    number: 12,
    labels: [
      { name: "collection: archivo-de-las-tormentas" },
      { name: "collection: cosmere" },
      { name: "kind: book" },
    ],
  });

  assert.equal(result.updated, true);
  assert.deepEqual(result.books[0].collections, [
    "archivo-de-las-tormentas",
    "cosmere",
  ]);
  assert.deepEqual(result.books[1], books[1]);
});

test("removes collections when the last collection label is removed", () => {
  const books = [{ issueNumber: 12, title: "A book", collections: ["cosmere"] }];

  const result = applyIssueCollections(books, {
    number: 12,
    labels: [{ name: "kind: book" }],
  });

  assert.equal("collections" in result.books[0], false);
});

test("supports string labels, trims values and removes duplicates", () => {
  const result = applyIssueCollections([{ issueNumber: 12 }], {
    number: 12,
    labels: ["collection:  cosmere ", "collection: cosmere"],
  });

  assert.deepEqual(result.books[0].collections, ["cosmere"]);
});

test("does not mutate the original API data and reports missing issues", () => {
  const books = [{ issueNumber: 99, title: "Untouched" }];
  const result = applyIssueCollections(books, {
    number: 12,
    labels: [{ name: "collection: cosmere" }],
  });

  assert.equal(result.updated, false);
  assert.deepEqual(books, [{ issueNumber: 99, title: "Untouched" }]);
});
