import test from "node:test";
import assert from "node:assert/strict";
import { mergeExactIsbnMetadata, mergeExactIsbnRecords } from "./book-metadata-merge.mjs";

test("fills missing fields from a supplemental exact-ISBN record", () => {
  const primary = {
    title: "El Rithmatista",
    authors: ["Brandon Sanderson"],
    publisher: "Nova",
    publishedDate: "2015",
    description: "",
    language: "",
    pageCount: 0,
    categories: ["Fantasía"],
    googleBooks: { id: "google-id", info: "https://books.google.com/one" },
  };
  const supplemental = {
    title: "El Rithmatista",
    authors: ["Brandon Sanderson"],
    publisher: "Editorial alternativa",
    publishedDate: "2015-01-12",
    description: "Descripción verificada",
    language: "es",
    pageCount: 448,
    averageRating: 4.5,
    ratingsCount: 10,
    categories: ["Ficción"],
    googleBooks: { id: "", info: "https://openlibrary.org/books/OL1" },
  };

  const merged = mergeExactIsbnMetadata(primary, supplemental);

  assert.equal(merged.publisher, "Nova");
  assert.equal(merged.publishedDate, "2015-01-12");
  assert.equal(merged.description, "Descripción verificada");
  assert.equal(merged.language, "es");
  assert.equal(merged.pageCount, 448);
  assert.equal(merged.averageRating, 4.5);
  assert.deepEqual(merged.categories, ["Fantasía", "Ficción"]);
  assert.equal(merged.googleBooks.id, "google-id");
  assert.equal(merged.googleBooks.info, "https://books.google.com/one");
  assert.equal(primary.description, "");
});

test("keeps populated primary fields and returns null for no matching records", () => {
  const primary = {
    title: "Book",
    authors: ["Author"],
    publisher: "Primary Publisher",
    publishedDate: "2020-04-03",
    description: "Primary description",
    language: "es",
    pageCount: 300,
    averageRating: 0,
    ratingsCount: 0,
    categories: ["Fantasy"],
  };
  const supplemental = {
    publisher: "Other Publisher",
    publishedDate: "2020",
    description: "Other description",
    language: "en",
    pageCount: 250,
    averageRating: 4,
    ratingsCount: 5,
    categories: ["Fantasy", "Adventure"],
  };

  const merged = mergeExactIsbnMetadata(primary, supplemental);

  assert.equal(merged.publisher, "Primary Publisher");
  assert.equal(merged.publishedDate, "2020-04-03");
  assert.equal(merged.description, "Primary description");
  assert.equal(merged.language, "es");
  assert.equal(merged.pageCount, 300);
  assert.equal(merged.averageRating, 4);
  assert.equal(merged.ratingsCount, 5);
  assert.deepEqual(merged.categories, ["Fantasy", "Adventure"]);
  assert.equal(mergeExactIsbnRecords([null, undefined]), null);
});


test("prefers a longer synopsis from a supplemental exact-ISBN provider", () => {
  const primary = {
    title: "The Hobbit",
    authors: ["J. R. R. Tolkien"],
    description: "A hobbit goes on an adventure.",
    categories: [],
  };
  const supplemental = {
    description: "Bilbo Baggins lives a quiet life until Gandalf arrives with a company of dwarves. Their journey takes them through dangerous lands toward a dragon's treasure.",
    categories: [],
  };

  const merged = mergeExactIsbnMetadata(primary, supplemental);

  assert.equal(merged.description, supplemental.description);
  assert.equal(primary.description, "A hobbit goes on an adventure.");
});

test("keeps the primary synopsis when the supplemental synopsis is shorter", () => {
  const primary = { title: "Book", authors: ["Author"], description: "A much longer and more useful description of the book." };
  const supplemental = { description: "A short description." };

  assert.equal(mergeExactIsbnMetadata(primary, supplemental).description, primary.description);
});
