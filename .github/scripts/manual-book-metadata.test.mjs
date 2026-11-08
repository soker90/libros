import test from "node:test";
import assert from "node:assert/strict";
import { getManualBookMetadata } from "./manual-book-metadata.mjs";

test("uses complete user-supplied edition metadata without requiring provider lookup", () => {
  const issue = {
    title: "Las naves de la magia (Las leyes del mar, #1) (ISBN 9791387690366)",
    body: `Author: Robin Hobb
ISBN: 9791387690366
Goodreads title: Las naves de la magia
Publisher: Nocturna Ediciones
Year published: 2026
Language: Español
Cover/source: https://www.nocturnaediciones.com/libro/465/naves_magia
Serie: Las leyes del mar, libro 1`,
  };

  const book = getManualBookMetadata(issue, "placeholder");
  assert.equal(book.title, "Las naves de la magia");
  assert.deepEqual(book.authors, ["Robin Hobb"]);
  assert.equal(book.isbn13, "9791387690366");
  assert.equal(book.publisher, "Nocturna Ediciones");
  assert.equal(book.publishedDate, "2026");
  assert.equal(book.language, "Español");
  assert.equal(book.image, "placeholder");
  assert.equal(book.metadataSource, "Manual issue metadata");
  assert.equal(book.sourceUrl, "https://www.nocturnaediciones.com/libro/465/naves_magia");
});

test("does not treat incomplete issue details as verified manual metadata", () => {
  const issue = {
    title: "A book (ISBN 9791387690366)",
    body: "Author: Robin Hobb\nISBN: 9791387690366",
  };

  assert.equal(getManualBookMetadata(issue, "placeholder"), null);
});
