import test from "node:test";
import assert from "node:assert/strict";
import { extractIsbn, isValidIsbn, scoreAuthor, scoreTitle, selectBestMatch } from "./book-matching.mjs";

test("validates ISBN-13 and ISBN-10 checksums", () => {
  assert.equal(isValidIsbn("978-0-306-40615-7"), true);
  assert.equal(isValidIsbn("978-0-306-40615-8"), false);
  assert.equal(isValidIsbn("0-8044-2957-X"), true);
  assert.equal(isValidIsbn("0-8044-2957-1"), false);
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
