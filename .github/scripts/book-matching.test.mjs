import test from "node:test";
import assert from "node:assert/strict";
import { extractIssueIsbn } from "./book-matching.mjs";

test("prefers the ISBN field in the source issue over an ISBN in stale metadata", () => {
  const issue = {
    title: "Isabella of Spain",
    body: `Author: William Thomas Walsh
ISBN: 9788498409741
Verified edition data:
- ISBN-13: 9781258217303
`,
  };

  assert.equal(extractIssueIsbn(issue), "9788498409741");
});

test("falls back to a verified ISBN elsewhere in the issue when Goodreads has none", () => {
  const issue = {
    title: "Legión: Las múltiples vidas de Stephen Leeds",
    body: `ISBN: Not listed in Goodreads export
Verified edition data:
- ISBN-13: 9788418037337
`,
  };

  assert.equal(extractIssueIsbn(issue), "9788418037337");
});

test("returns an empty string when the issue has no valid ISBN", () => {
  assert.equal(extractIssueIsbn({ title: "No ISBN", body: "ISBN: not listed" }), "");
});
