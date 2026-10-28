/** Normalize text for tolerant title and author comparisons. */
export function normalizeText(value = "") {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normalizeIsbn(value = "") {
  return value.replace(/[^0-9Xx]/g, "").toUpperCase();
}

/** Return equivalent ISBN-10/ISBN-13 forms for the same publication identifier. */
export function equivalentIsbns(value = "") {
  const isbn = normalizeIsbn(value);
  if (/^978\d{10}$/.test(isbn)) {
    const stem = isbn.slice(3, 12);
    const checksum = [...stem].reduce((sum, digit, index) => sum + Number(digit) * (10 - index), 0);
    const checkDigit = (11 - (checksum % 11)) % 11;
    return [isbn, `${stem}${checkDigit === 10 ? "X" : checkDigit}`];
  }

  if (/^\d{9}[\dX]$/.test(isbn)) {
    const stem = `978${isbn.slice(0, 9)}`;
    const checksum = [...stem].reduce((sum, digit, index) => sum + Number(digit) * (index % 2 ? 3 : 1), 0);
    return [isbn, `${stem}${(10 - (checksum % 10)) % 10}`];
  }

  return [isbn];
}

/** Validate ISBN-10 and ISBN-13 checksums, not just their length. */
export function isValidIsbn(value) {
  const isbn = normalizeIsbn(value);

  if (/^\d{13}$/.test(isbn)) {
    const checksum = [...isbn].reduce(
      (sum, digit, index) => sum + Number(digit) * (index % 2 ? 3 : 1),
      0,
    );
    return checksum % 10 === 0;
  }

  if (/^\d{9}[\dX]$/.test(isbn)) {
    const checksum = [...isbn].reduce(
      (sum, digit, index) => sum + (digit === "X" ? 10 : Number(digit)) * (10 - index),
      0,
    );
    return checksum % 11 === 0;
  }

  return false;
}

export function extractIsbn(text = "") {
  const pattern = /(?:97[89][\\s-]?(?:\\d[\\s-]?){10}|\\d[\\s-]?(?:\\d[\\s-]?){8}[\\dXx])/g;
  return (text.match(pattern) || []).map(normalizeIsbn).find(isValidIsbn) || "";
}

/**
 * Prefer the ISBN explicitly recorded in the source issue over stale provider
 * metadata. If the field is absent or unparseable, fall back to ISBNs elsewhere
 * in the issue title/body (including a manually verified edition section).
 */
export function extractIssueIsbn(issue) {
  const body = typeof issue?.body === "string" ? issue.body : "";
  const isbnField = body.match(/^ISBN\\s*:\\s*(.+?)\\s*$/im)?.[1] || "";
  return extractIsbn(isbnField)
    || extractIsbn(issue?.title || "")
    || extractIsbn(body);
}

export function extractAuthor(body = "") {
  const match = body.match(/^\s*(?:author|autor|by|escrito por)\s*:\s*(.+?)\s*$/im);
  return match?.[1]?.trim() || "";
}

export function removeIsbnFromTitle(title = "") {
  return title
    .replace(/(?:97[89][\s-]?(?:\d[\s-]?){10}|\d[\s-]?(?:\d[\s-]?){8}[\dXx])/g, " ")
    .replace(/[()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function scoreTitle(expected, candidate) {
  const expectedText = normalizeText(expected);
  const candidateText = normalizeText(candidate);
  if (!expectedText || !candidateText) return 0;
  if (expectedText === candidateText) return 12;
  if (candidateText.includes(expectedText) || expectedText.includes(candidateText)) return 7;

  const expectedWords = new Set(expectedText.split(" ").filter((word) => word.length > 1));
  const candidateWords = new Set(candidateText.split(" ").filter((word) => word.length > 1));
  const sharedWords = [...expectedWords].filter((word) => candidateWords.has(word)).length;
  return expectedWords.size ? (sharedWords / expectedWords.size) * 6 : 0;
}

export function scoreAuthor(expected, authors = []) {
  if (!expected) return 0;
  const wanted = normalizeText(expected);
  return authors.some((author) => {
    const actual = normalizeText(author);
    return actual === wanted || actual.includes(wanted) || wanted.includes(actual);
  }) ? 7 : -3;
}

export function rankBook(book, title, author = "") {
  return scoreTitle(title, book.title) + scoreAuthor(author, book.authors);
}

export function selectBestMatch(books, title, author = "") {
  const threshold = author ? 10 : 8;
  const best = books
    .map((book) => ({ book, score: rankBook(book, title, author) }))
    .toSorted((left, right) => right.score - left.score)[0];

  return best && best.score >= threshold ? best.book : null;
}
