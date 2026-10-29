const MERGEABLE_FIELDS = [
  "publisher",
  "publishedDate",
  "description",
  "image",
  "language",
  "averageRating",
  "ratingsCount",
  "pageCount",
  "isbn10",
  "isbn13",
];

function isMissing(value, field) {
  if (value === undefined || value === null || value === "") return true;
  if (Array.isArray(value) && value.length === 0) return true;
  if (["averageRating", "ratingsCount", "pageCount"].includes(field) && value === 0) return true;
  return false;
}

function isYearOnly(value) {
  return typeof value === "string" && /^\d{4}$/.test(value);
}

/**
 * Merge metadata from providers that have independently matched the same ISBN.
 * The first provider remains authoritative for populated fields; supplemental
 * providers only fill gaps or replace a year-only date with a full date.
 */
export function mergeExactIsbnMetadata(primary, supplemental) {
  const merged = { ...primary };

  for (const field of MERGEABLE_FIELDS) {
    const current = merged[field];
    const candidate = supplemental[field];
    if (isMissing(current, field) && !isMissing(candidate, field)) {
      merged[field] = candidate;
      continue;
    }

    // When both exact-ISBN providers have a synopsis, retain the more complete
    // description instead of letting a short primary snippet hide it.
    if (
      field === "description"
      && typeof candidate === "string"
      && candidate.trim().length > (typeof current === "string" ? current.trim().length : 0)
    ) {
      merged[field] = candidate;
      continue;
    }

    if (
      field === "publishedDate"
      && isYearOnly(current)
      && typeof candidate === "string"
      && /^\d{4}-\d{2}-\d{2}$/.test(candidate)
      && candidate.startsWith(current)
    ) {
      merged[field] = candidate;
    }
  }

  const primaryAuthors = Array.isArray(primary.authors) ? primary.authors : [];
  const supplementalAuthors = Array.isArray(supplemental.authors) ? supplemental.authors : [];
  merged.authors = primaryAuthors.length ? primaryAuthors : supplementalAuthors;

  const primaryCategories = Array.isArray(primary.categories) ? primary.categories : [];
  const supplementalCategories = Array.isArray(supplemental.categories) ? supplemental.categories : [];
  merged.categories = [...new Set([...primaryCategories, ...supplementalCategories])];

  merged.googleBooks = {
    ...(supplemental.googleBooks || {}),
    ...(primary.googleBooks || {}),
  };

  return merged;
}

/** Merge ordered, independently verified records for one exact ISBN. */
export function mergeExactIsbnRecords(records) {
  return records.filter(Boolean).reduce(
    (primary, supplemental) => primary ? mergeExactIsbnMetadata(primary, supplemental) : supplemental,
    null,
  );
}
