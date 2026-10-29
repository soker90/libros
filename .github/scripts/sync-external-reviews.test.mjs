import test from "node:test";
import assert from "node:assert/strict";
import { applyExternalReviews, parseCollections, parseExternalReviews } from "./sync-external-reviews.mjs";

test("parses approved external review comments and normalizes source names", () => {
  const reviews = parseExternalReviews([
    { body: "Reseña externa: Aceprensa\nhttps://www.aceprensa.com/resenas-libros/example/" },
    { body: "Reseña externa: Biblioteca de Nehemías\nhttps://bibliotecadenehemias.example/book" },
    { body: "Reseña externa: La Biblioteca de Nehemías — reseña de una novela\nhttps://bibliotecadenehemias.example/annotated" },
    { body: "Reseña externa: Delibris (reseña en inglés)\nhttps://www.delibris.org/en/example" },
    { body: "Reseña externa: sitio desconocido\nhttps://example.com/book" },
    { body: "A regular comment with https://example.com/book" },
  ]);

  assert.deepEqual(reviews, [
    { source: "Aceprensa", title: "Aceprensa", url: "https://www.aceprensa.com/resenas-libros/example/" },
    { source: "Biblioteca de Nehemías", title: "Biblioteca de Nehemías", url: "https://bibliotecadenehemias.example/book" },
    { source: "Biblioteca de Nehemías", title: "Biblioteca de Nehemías", url: "https://bibliotecadenehemias.example/annotated" },
    { source: "Delibris", title: "Delibris", url: "https://www.delibris.org/en/example" },
  ]);
});

test("deduplicates URLs and ignores unsafe URLs", () => {
  const reviews = parseExternalReviews([
    { body: "Reseña externa: De libros\nhttps://delibros.example/book" },
    { body: "Reseña externa: De libros\nhttps://delibros.example/book" },
    { body: "Reseña externa: De libros\njavascript:alert(1)" },
  ]);
  assert.equal(reviews.length, 1);
});

test("copies reviews to only the matching API entry and removes stale reviews", () => {
  const books = [
    { issueNumber: 12, title: "A book", externalReviews: [{ source: "Old", url: "https://old.example" }] },
    { issueNumber: 13, title: "Another book" },
  ];
  const result = applyExternalReviews(books, 12, [
    { body: "Reseña externa: Aceprensa\nhttps://www.aceprensa.com/review/" },
  ]);

  assert.equal(result.updated, true);
  assert.deepEqual(result.books[0].externalReviews, [
    { source: "Aceprensa", title: "Aceprensa", url: "https://www.aceprensa.com/review/" },
  ]);
  assert.deepEqual(result.books[1], books[1]);
  assert.equal("externalReviews" in applyExternalReviews(books, 12, []).books[0], false);
});

test("reports when the issue has no corresponding API entry", () => {
  const books = [{ issueNumber: 99, title: "Untouched" }];
  const result = applyExternalReviews(books, 12, []);
  assert.equal(result.updated, false);
  assert.deepEqual(books, [{ issueNumber: 99, title: "Untouched" }]);
});

test("parses collection metadata from issue comments and labels", () => {
  assert.deepEqual(parseCollections(
    [{ body: "Colección: Terramar\nColección: fantasía clásica" }],
    [{ name: "collection: Terramar" }, { name: "kind: book" }],
  ), ["Terramar", "fantasía clásica"]);
});

test("syncs collections alongside reviews and removes stale collection metadata", () => {
  const books = [{ issueNumber: 12, title: "A book", collections: ["Old collection"] }];
  const result = applyExternalReviews(books, 12, [
    { body: "Reseña externa: Aceprensa\nhttps://www.aceprensa.com/review/" },
    { body: "Colección: Terramar" },
  ]);

  assert.deepEqual(result.books[0].collections, ["Terramar"]);
  assert.equal("collections" in applyExternalReviews(books, 12, [], []).books[0], false);
});
