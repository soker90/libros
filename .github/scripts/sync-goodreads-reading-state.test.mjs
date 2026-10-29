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
Publisher in Goodreads: Nova
Year published in Goodreads: 2026
Format: Tapa blanda
Cover URL: https://example.org/cover.jpg
`;

test("parses Goodreads status, dates, ISBN, and explicit edition metadata from issue body", () => {
  assert.deepEqual(parseGoodreadsReadingData(issueBody), {
    shelf: "read",
    startedAt: "2026-02-16T00:00:00.000Z",
    completedAt: "2026-03-10T00:00:00.000Z",
    isbn13: "9788410466203",
    publisher: "Nova",
    publishedDate: "2026",
    language: null,
    format: "Tapa blanda",
    cover: "https://example.org/cover.jpg",
    description: null,
    pageCount: null,
    categories: null,
    verified: false,
  });
});

test("uses source ISBN and verified metadata instead of a mismatched edition", () => {
  const books = [{
    issueNumber: 25,
    title: "1984",
    authors: ["George Orwell"],
    isbn13: "9781784043735",
    publisher: "Arcturus Publishing",
    publishedDate: "2014-01-04",
    description: "Description of the English edition",
    image: "https://example.org/english-cover.jpg",
    language: "en",
    averageRating: 4,
    ratingsCount: 7,
    categories: ["Fiction"],
    pageCount: 361,
    format: "Paperback",
    isbn10: "1784043737",
    googleBooks: { id: "english-edition" },
    state: "completed",
  }];
  const body = issueBody
    .replace("ISBN: 9788410466203", "ISBN: 9786078578245")
    .replace("Publisher in Goodreads: Nova\n", "Publisher in Goodreads: Total Books\n")
    .replace("Year published in Goodreads: 2026\n", "Year published in Goodreads: 2020\n")
    .replace("Format: Tapa blanda\n", "Format: Paperback\n")
    .replace("Cover URL: https://example.org/cover.jpg\n", "")
    + `Verified publisher: Total Book
Verified publication date: 2019-11-01
Verified format: Paperback
Verified page count: 160
Language: Spanish
Verified description: Winston Smith works for a regime that rewrites history and monitors citizens; as he questions the Party, he tries to preserve truth and personal freedom.
Verified categories: Narrativa; Clásicos universales; Distopía
Verified source: https://www.imosver.com/es/libros/1984-TOR0008474
Verified cover URL: https://example.org/spanish-cover.jpg
`;
  const result = applyGoodreadsReadingData(books, [{
    number: 25,
    body,
    labels: [{ name: "language: español" }],
  }]);
  const book = result.books[0];

  assert.equal(book.isbn13, "9786078578245");
  assert.equal(book.requestedIsbn, "9786078578245");
  assert.equal(book.publisher, "Total Book");
  assert.equal(book.publishedDate, "2019-11-01");
  assert.equal(book.language, "es");
  assert.equal(book.format, "Paperback");
  assert.equal(book.pageCount, 160);
  assert.equal(book.image, "https://example.org/spanish-cover.jpg");
  assert.match(book.description, /Winston Smith/);
  assert.deepEqual(book.categories, ["Narrativa", "Clásicos universales", "Distopía"]);
  assert.equal(book.metadataSource, "Exact ISBN match; edition metadata verified against ISBN-specific catalogue sources");
  assert.equal("averageRating" in book, false);
  assert.equal("ratingsCount" in book, false);
  assert.equal("googleBooks" in book, false);
  assert.equal(book.authors[0], "George Orwell");
  assert.equal(book.state, "completed");
});

test("syncs explicit format and cover while preserving edition-specific data when absent", () => {
  const books = [
    { issueNumber: 70, title: "Realidades a medida" },
    { issueNumber: 69, title: "Legión", format: "Audiolibro", narrator: "Íñigo Álvarez de Lara" },
  ];
  const issues = [
    { number: 70, body: issueBody },
    {
      number: 69,
      body: issueBody.replace("Goodreads ID: 241240148", "Goodreads ID: 201288898")
        .replace("ISBN: 9788410466203", "ISBN: Not listed in Goodreads export")
        .replace("Publisher in Goodreads: Nova\n", "")
        .replace("Year published in Goodreads: 2026\n", "")
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
    isbn13: "9788410466203",
    publisher: "Nova",
    publishedDate: "2026",
    language: null,
    format: "Tapa blanda",
    cover: "https://example.org/cover.jpg",
    description: null,
    pageCount: null,
    categories: null,
    verified: false,
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
