import test from "node:test";
import assert from "node:assert/strict";
import { applyGoodreadsReadingData, formatDuration, parseGoodreadsReadingData } from "./sync-goodreads-reading-state.mjs";

const issueBody = `Author: Brandon Sanderson
Goodreads ID: 241240148
ISBN: 9788410466203
Goodreads shelf: read
Goodreads rating: 4/5
Date added: 2026/02/16
Date read: 2026/03/10
Format: Tapa blanda
Cover URL: https://example.org/cover.jpg
`;

test("parses Goodreads status, dates, and explicit edition format from issue body", () => {
  assert.deepEqual(parseGoodreadsReadingData(issueBody), {
    shelf: "read",
    startedAt: "2026-02-16T00:00:00.000Z",
    completedAt: "2026-03-10T00:00:00.000Z",
    format: "Tapa blanda",
    cover: "https://example.org/cover.jpg",
  });
});

test("syncs explicit format while preserving edition-specific data when format is absent", () => {
  const books = [
    { issueNumber: 70, title: "Realidades a medida" },
    { issueNumber: 69, title: "Legión", format: "Audiolibro", narrator: "Íñigo Álvarez de Lara" },
  ];
  const issues = [
    { number: 70, body: issueBody },
    {
      number: 69,
      body: issueBody.replace("Goodreads ID: 241240148", "Goodreads ID: 201288898")
        .replace("Goodreads shelf: read", "Goodreads shelf: read")
        .replace("Format: Tapa blanda\n", "")
        .replace("Cover URL: https://example.org/cover.jpg\n", ""),
    },
  ];

  const result = applyGoodreadsReadingData(books, issues);
  assert.equal(result.books[0].format, "Tapa blanda");
  assert.equal(result.books[0].image, "https://example.org/cover.jpg");
  assert.equal(result.books[1].format, "Audiolibro");
  assert.equal(result.books[1].narrator, "Íñigo Álvarez de Lara");
});

test("ignores pull requests and issues without valid Goodreads identifiers", () => {
  const books = [{ issueNumber: 1, state: "reading" }];
  const result = applyGoodreadsReadingData(books, [
    { number: 1, pull_request: {}, body: issueBody },
    { number: 1, body: "No Goodreads data here" },
  ]);

  assert.equal(result.updated, 0);
  assert.equal(result.books[0].state, "reading");
});

test("uses Date Read as the start when Goodreads Date Added is later", () => {
  const body = issueBody
    .replace("Date added: 2026/02/16", "Date added: 2023/08/28")
    .replace("Date read: 2026/03/10", "Date read: 2023/08/07");

  assert.deepEqual(parseGoodreadsReadingData(body), {
    shelf: "read",
    startedAt: "2023-08-07T00:00:00.000Z",
    completedAt: "2023-08-07T00:00:00.000Z",
    format: "Tapa blanda",
    cover: "https://example.org/cover.jpg",
  });
});

test("recalculates reading duration from synchronized Goodreads dates", () => {
  const books = [{
    issueNumber: 70,
    state: "completed",
    timeToComplete: 22_000,
    timeToCompleteFormatted: "22 seconds",
  }];
  const result = applyGoodreadsReadingData(books, [{ number: 70, body: issueBody }]);

  assert.equal(result.books[0].timeToComplete, 22 * 24 * 60 * 60 * 1000);
  assert.equal(result.books[0].timeToCompleteFormatted, "3 weeks");
});

test("formats zero and longer durations consistently", () => {
  assert.equal(formatDuration(0), "0 seconds");
  assert.equal(formatDuration(35 * 24 * 60 * 60 * 1000), "1 month");
  assert.equal(formatDuration(400 * 24 * 60 * 60 * 1000), "1 year");
});
