import test from "node:test";
import assert from "node:assert/strict";
import { parseSpanishCatalogBook } from "./spanish-book-catalog.mjs";

const isbn = "9788445018910";

test("accepts a publisher page with the exact ISBN in JSON-LD", () => {
  const html = `<!doctype html><html><head>
    <meta property="og:image" content="https://example.test/cover.jpg">
    <script type="application/ld+json">
      {"@type":"Book","name":"Ciclo Pendragon nº 02/06 Merlín","isbn":"978-84-450-1891-0","author":{"@type":"Person","name":"Stephen R. Lawhead"},"publisher":{"@type":"Organization","name":"Minotauro"},"datePublished":"2025-07-02","numberOfPages":480}
    </script>
    </head><body><h1>Ciclo Pendragon nº 02/06 Merlín</h1></body></html>`;

  const book = parseSpanishCatalogBook(html, isbn, "https://example.test/book");

  assert.equal(book.title, "Ciclo Pendragon nº 02/06 Merlín");
  assert.deepEqual(book.authors, ["Stephen R. Lawhead"]);
  assert.equal(book.publisher, "Minotauro");
  assert.equal(book.isbn13, isbn);
  assert.equal(book.publishedDate, "2025-07-02");
});

test("rejects a publisher page whose ISBN does not match", () => {
  const html = `<html><body><h1>Another edition</h1><p>ISBN: 978-84-450-0000-0</p></body></html>`;
  assert.equal(parseSpanishCatalogBook(html, isbn, "https://example.test/book"), null);
});

test("rejects pages without a verifiable ISBN", () => {
  const html = `<html><body><h1>Ciclo Pendragon nº 02/06 Merlín</h1></body></html>`;
  assert.equal(parseSpanishCatalogBook(html, isbn, "https://example.test/book"), null);
});
