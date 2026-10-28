import test from "node:test";
import assert from "node:assert/strict";
import { normalizeBooksPublicationDates, normalizePublicationDate } from "./normalize-publication-dates.mjs";

test("normalizes ISO, year-first slash, English and Spanish dates", () => {
  assert.equal(normalizePublicationDate("2025-07-02"), "2025-07-02");
  assert.equal(normalizePublicationDate("2024/12/09"), "2024-12-09");
  assert.equal(normalizePublicationDate("Feb 23, 2021"), "2021-02-23");
  assert.equal(normalizePublicationDate("Jun 10, 2021"), "2021-06-10");
  assert.equal(normalizePublicationDate("19-01-2023"), "2023-01-19");
  assert.equal(normalizePublicationDate("11 de diciembre de 2025"), "2025-12-11");
  assert.equal(normalizePublicationDate("5 de noviembre 2025"), "2025-11-05");
});

test("preserves years, ambiguous formats, invalid dates and unknown strings", () => {
  assert.equal(normalizePublicationDate("2018"), "2018");
  assert.equal(normalizePublicationDate("03-04-2023"), "03-04-2023");
  assert.equal(normalizePublicationDate("2023-02-30"), "2023-02-30");
  assert.equal(normalizePublicationDate("Spring 2023"), "Spring 2023");
  assert.equal(normalizePublicationDate(""), "");
});

test("normalizes book data without mutating unrelated fields", () => {
  const books = [
    { issueNumber: 1, publishedDate: "Feb 23, 2021", title: "Book" },
    { issueNumber: 2, publishedDate: "2018", title: "Other" },
    { issueNumber: 3, title: "No date" },
  ];
  const result = normalizeBooksPublicationDates(books);

  assert.equal(result.changed, 1);
  assert.deepEqual(result.books, [
    { issueNumber: 1, publishedDate: "2021-02-23", title: "Book" },
    { issueNumber: 2, publishedDate: "2018", title: "Other" },
    { issueNumber: 3, title: "No date" },
  ]);
  assert.equal(books[0].publishedDate, "Feb 23, 2021");
});
