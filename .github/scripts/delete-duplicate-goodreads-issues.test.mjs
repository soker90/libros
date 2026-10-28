import test from "node:test";
import assert from "node:assert/strict";
import { findDuplicateGoodreadsIssues } from "./delete-duplicate-goodreads-issues.mjs";

test("selects the richer Goodreads issue and identifies the legacy duplicate for deletion", () => {
  const issues = [
    {
      number: 46,
      node_id: "I_46",
      body: "Author: Robin Hobb\nGoodreads ID: 230787090\nISBN: 9788419680976\nGoodreads title: La búsqueda del asesino\nDate added: 2025/12/08\nDate read: 2025/12/31\nGoodreads status synced from export: 2026-10-28.",
      labels: [{ name: "kind: book" }],
    },
    {
      number: 72,
      node_id: "I_72",
      body: "Author: Robin Hobb\nGoodreads ID: 230787090\nISBN: 9788419680976\nGoodreads title: La búsqueda del asesino\nDate added: 2025/12/08\nDate read: 2025/12/31\nFormat: Tapa blanda\nImported from Goodreads. Keep the Goodreads ID and ISBN to identify this exact edition.\nGoodreads status synced from export: 2026-10-28.",
      labels: [{ name: "kind: book" }],
    },
  ];

  assert.deepEqual(findDuplicateGoodreadsIssues([{ issueNumber: 72 }], issues), [
    {
      goodreadsId: "230787090",
      duplicateIssueNumber: 46,
      duplicateNodeId: "I_46",
      canonicalIssueNumber: 72,
    },
  ]);
});

test("deletes duplicate issues only when the canonical issue exists in the generated catalogue", () => {
  const issues = [
    { number: 88, node_id: "I_88", body: "Goodreads ID: 55300645\nFormat: Tapa dura", labels: [{ name: "kind: book" }] },
    { number: 89, node_id: "I_89", body: "Goodreads ID: 55300645", labels: [] },
  ];

  assert.deepEqual(findDuplicateGoodreadsIssues([{ issueNumber: 90 }], issues), []);
});

test("does not merge distinct Goodreads records even when their ISBNs match", () => {
  const issues = [
    { number: 10, node_id: "I_10", body: "Goodreads ID: 100\nISBN: 9788466658904", labels: [] },
    { number: 11, node_id: "I_11", body: "Goodreads ID: 200\nISBN: 9788466658904", labels: [] },
  ];

  assert.deepEqual(findDuplicateGoodreadsIssues([{ issueNumber: 10 }, { issueNumber: 11 }], issues), []);
});
