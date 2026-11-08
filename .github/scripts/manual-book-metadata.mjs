import { extractIssueIsbn, extractAuthor, removeIsbnFromTitle } from "./book-matching.mjs";

const FIELD_LABELS = {
  title: ["Goodreads title", "Título", "Title"],
  publisher: ["Publisher", "Editorial"],
  year: ["Year published", "Año de publicación", "Año"],
  language: ["Language", "Idioma"],
  sourceUrl: ["Cover/source", "Portada/fuente", "Fuente"],
  description: ["Description", "Sinopsis", "Descripción"],
};

function getField(body, labels) {
  const alternatives = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return body.match(new RegExp("^\\s*(?:" + alternatives + ")\\s*:\\s*(.+?)\\s*$", "im"))?.[1]?.trim() || "";
}

/**
 * Build a Bookshelf Action-compatible metadata record from a fully supplied issue.
 * Manual metadata is authoritative and must not trigger provider lookups.
 */
export function getManualBookMetadata(issue, fallbackImage) {
  const body = typeof issue?.body === "string" ? issue.body : "";
  const title = getField(body, FIELD_LABELS.title) || removeIsbnFromTitle(issue?.title || "");
  const author = extractAuthor(body);
  const isbn = extractIssueIsbn(issue);
  const publisher = getField(body, FIELD_LABELS.publisher);
  const year = getField(body, FIELD_LABELS.year);
  const language = getField(body, FIELD_LABELS.language);

  if (!title || !author || !isbn || !publisher || !/^\d{4}$/.test(year) || !language) {
    return null;
  }

  const sourceUrl = getField(body, FIELD_LABELS.sourceUrl);
  return {
    title,
    authors: [author],
    publisher,
    publishedDate: year,
    description: getField(body, FIELD_LABELS.description),
    image: fallbackImage,
    language,
    averageRating: 0,
    ratingsCount: 0,
    categories: [],
    pageCount: 0,
    ...(isbn.length === 13 ? { isbn13: isbn } : { isbn10: isbn }),
    googleBooks: { id: "", preview: sourceUrl, info: sourceUrl, canonical: sourceUrl },
    metadataSource: "Manual issue metadata",
    sourceUrl,
    sourceName: "User-supplied edition details",
  };
}
