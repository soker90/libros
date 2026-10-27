import test from "node:test";
import assert from "node:assert/strict";
import { equivalentIsbns, extractIsbn, isValidIsbn, scoreAuthor, scoreTitle, selectBestMatch } from "./book-matching.mjs";
import { findVerifiedBookOverride } from "./book-overrides.mjs";

test("validates ISBN-13 and ISBN-10 checksums", () => {
  assert.equal(isValidIsbn("978-0-306-40615-7"), true);
  assert.equal(isValidIsbn("978-0-306-40615-8"), false);
  assert.equal(isValidIsbn("0-8044-2957-X"), true);
  assert.equal(isValidIsbn("0-8044-2957-1"), false);
});

test("converts equivalent ISBN-10 and ISBN-13 identifiers", () => {
  assert.deepEqual(equivalentIsbns("9788445018910"), ["9788445018910", "8445018914"]);
  assert.deepEqual(equivalentIsbns("8445018914"), ["8445018914", "9788445018910"]);
  assert.deepEqual(equivalentIsbns("9780306406157"), ["9780306406157", "0306406152"]);
});

test("extracts an ISBN from an issue title or body text", () => {
  assert.equal(extractIsbn("The Example Book (ISBN 978-0-306-40615-7)"), "9780306406157");
  assert.equal(extractIsbn("ISBN: 0-8044-2957-X"), "080442957X");
  assert.equal(extractIsbn("A title with an invalid ISBN 978-0-306-40615-8"), "");
});

test("normalizes accents and punctuation when comparing titles", () => {
  assert.equal(scoreTitle("El hombre que era Jueves", "El hombre que era jueves"), 12);
  assert.ok(scoreTitle("The Last Wish", "The Last Wish: Introducing the Witcher") > 0);
});

test("author match strongly affects candidate ranking", () => {
  assert.equal(scoreAuthor("J. R. R. Tolkien", ["J. R. R. Tolkien"]), 7);
  assert.equal(scoreAuthor("Ursula Le Guin", ["J. R. R. Tolkien"]), -3);
  assert.equal(scoreAuthor("", ["J. R. R. Tolkien"]), 0);
});

test("selects the best title and author match and rejects weak candidates", () => {
  const books = [
    { title: "The Last Wish", authors: ["Andrzej Sapkowski"] },
    { title: "The Last Wish", authors: ["Another Author"] },
    { title: "Last Wishes", authors: ["Another Author"] },
  ];

  assert.equal(selectBestMatch(books, "The Last Wish", "Andrzej Sapkowski"), books[0]);
  assert.equal(selectBestMatch(books, "Completely Different Title"), null);
});

test("returns a verified exact-edition override for either equivalent ISBN", () => {
  const isbn13Book = findVerifiedBookOverride("9788445018910");
  const isbn10Book = findVerifiedBookOverride("8445018914");

  assert.equal(isbn13Book.title, "Ciclo Pendragon nº 02/06 Merlín");
  assert.equal(isbn13Book.authors[0], "Stephen R. Lawhead");
  assert.equal(isbn13Book.publisher, "Minotauro");
  assert.equal(isbn13Book.isbn13, "9788445018910");
  assert.equal(isbn10Book.isbn10, "8445018914");
  assert.equal(findVerifiedBookOverride("9780306406157"), null);
});
