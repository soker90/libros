import { equivalentIsbns, normalizeIsbn, normalizeText, selectBestMatch } from "./book-matching.mjs";
import { findSpanishCatalogBookByIsbn } from "./spanish-book-catalog.mjs";
import { findVerifiedBookOverride } from "./book-overrides.mjs";

const GOOGLE_BOOKS_API = "https://www.googleapis.com/books/v1/volumes";
const OPEN_LIBRARY_API = "https://openlibrary.org";
const USER_AGENT = "soker90-libros/1.0 (GitHub Actions)";

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Request failed (${response.status}) for ${url}`);
  return response.json();
}

function getIdentifiers(identifiers = []) {
  return {
    isbn10: identifiers.find((item) => item.type === "ISBN_10")?.identifier,
    isbn13: identifiers.find((item) => item.type === "ISBN_13")?.identifier,
  };
}

function normalizeGoogleBook(item) {
  const info = item.volumeInfo || {};
  return {
    title: info.title || "",
    authors: info.authors || [],
    publisher: info.publisher || "",
    publishedDate: info.publishedDate || "",
    description: info.description || "",
    image: info.imageLinks?.thumbnail?.replace(/^http:/, "https:") || "",
    language: info.language || "",
    averageRating: info.averageRating || 0,
    ratingsCount: info.ratingsCount || 0,
    categories: info.categories || [],
    pageCount: info.pageCount || 0,
    ...getIdentifiers(info.industryIdentifiers || []),
    googleBooks: {
      id: item.id || "",
      preview: info.previewLink || "",
      info: info.infoLink || "",
      canonical: info.canonicalVolumeLink || "",
    },
  };
}

function normalizeOpenLibraryIsbnBook(item, requestedIsbn) {
  const identifiers = item.identifiers || {};
  return {
    title: item.title || "",
    authors: (item.authors || []).map((author) => author.name).filter(Boolean),
    publisher: (item.publishers || []).map((publisher) => publisher.name).filter(Boolean).join(", "),
    publishedDate: item.publish_date || "",
    description: typeof item.notes === "string" ? item.notes : "",
    image: (item.cover?.large || item.cover?.medium || item.cover?.small || "").replace(/^http:/, "https:"),
    language: "",
    averageRating: 0,
    ratingsCount: 0,
    categories: (item.subjects || []).map((subject) => subject.name).filter(Boolean),
    pageCount: item.number_of_pages || 0,
    isbn10: identifiers.isbn_10?.[0] || (/^\d{9}[\dX]$/.test(requestedIsbn) ? requestedIsbn : undefined),
    isbn13: identifiers.isbn_13?.[0] || (/^\d{13}$/.test(requestedIsbn) ? requestedIsbn : undefined),
    googleBooks: {
      id: "",
      preview: item.url || "",
      info: item.url || "",
      canonical: item.url || "",
    },
  };
}

function normalizeOpenLibrarySearchBook(item) {
  const key = item.key || "";
  const isbns = item.isbn || [];
  return {
    title: item.title || "",
    authors: item.author_name || [],
    publisher: item.publisher?.[0] || "",
    publishedDate: item.first_publish_year ? String(item.first_publish_year) : "",
    description: "",
    image: item.cover_i ? `https://covers.openlibrary.org/b/id/${item.cover_i}-L.jpg` : "",
    language: item.language?.[0] || "",
    averageRating: 0,
    ratingsCount: 0,
    categories: item.subject || [],
    pageCount: item.number_of_pages_median || 0,
    isbn10: isbns.find((value) => /^\d{9}[\dXx]$/.test(normalizeIsbn(value))),
    isbn13: isbns.find((value) => /^\d{13}$/.test(normalizeIsbn(value))),
    googleBooks: {
      id: "",
      preview: key ? `${OPEN_LIBRARY_API}${key}` : "",
      info: key ? `${OPEN_LIBRARY_API}${key}` : "",
      canonical: key ? `${OPEN_LIBRARY_API}${key}` : "",
    },
  };
}

function hasIsbn(book, isbn) {
  const requestedForms = equivalentIsbns(isbn);
  return [book.isbn10, book.isbn13]
    .filter(Boolean)
    .flatMap(equivalentIsbns)
    .some((candidate) => requestedForms.includes(candidate));
}

async function searchGoogleBooks(query) {
  const url = `${GOOGLE_BOOKS_API}?q=${encodeURIComponent(query)}&maxResults=20&printType=books`;
  const data = await fetchJson(url);
  return (data.items || []).map(normalizeGoogleBook);
}

/** Return only an exact ISBN match; never silently substitute another edition. */
export async function findBookByIsbn(isbn) {
  const verifiedOverride = findVerifiedBookOverride(isbn);
  if (verifiedOverride && hasIsbn(verifiedOverride, isbn)) return verifiedOverride;

  const identifiers = equivalentIsbns(isbn);

  for (const identifier of identifiers) {
    try {
      const candidates = await searchGoogleBooks(`isbn:${identifier}`);
      const exactMatch = candidates.find((book) => hasIsbn(book, isbn));
      if (exactMatch) return exactMatch;
    } catch (error) {
      console.warn(`Google Books ISBN lookup failed for ${identifier}:`, error.message);
    }
  }

  for (const identifier of identifiers) {
    const key = `ISBN:${identifier}`;
    try {
      const url = `${OPEN_LIBRARY_API}/api/books?bibkeys=${encodeURIComponent(key)}&format=json&jscmd=data`;
      const data = await fetchJson(url);
      if (data[key]) {
        const book = normalizeOpenLibraryIsbnBook(data[key], identifier);
        if (hasIsbn(book, isbn)) return book;
      }
    } catch (error) {
      console.warn(`Open Library ISBN record lookup failed for ${identifier}:`, error.message);
    }
  }

  for (const identifier of identifiers) {
    try {
      const params = new URLSearchParams({ isbn: identifier, limit: "20" });
      const data = await fetchJson(`${OPEN_LIBRARY_API}/search.json?${params.toString()}`);
      const candidates = (data.docs || []).map(normalizeOpenLibrarySearchBook);
      const exactMatch = candidates.find((book) => hasIsbn(book, isbn));
      if (exactMatch) return exactMatch;
    } catch (error) {
      console.warn(`Open Library ISBN search failed for ${identifier}:`, error.message);
    }
  }

  const spanishCatalogBook = await findSpanishCatalogBookByIsbn(isbn);
  if (spanishCatalogBook && hasIsbn(spanishCatalogBook, isbn)) return spanishCatalogBook;

  return null;
}

export async function findBookByTitle(title, author = "") {
  const queries = [
    `intitle:${title}${author ? `+inauthor:${author}` : ""}`,
    `"${title}"${author ? `+${author}` : ""}`,
  ];
  const candidates = new Map();

  for (const query of queries) {
    try {
      for (const book of await searchGoogleBooks(query)) {
        const key = book.googleBooks.id || `${normalizeText(book.title)}:${book.authors.map(normalizeText).join(",")}`;
        candidates.set(key, book);
      }
    } catch (error) {
      console.warn("Google Books title lookup failed:", error.message);
    }
  }

  try {
    const params = new URLSearchParams({ title, limit: "20" });
    if (author) params.set("author", author);
    const data = await fetchJson(`${OPEN_LIBRARY_API}/search.json?${params.toString()}`);
    const openLibraryBooks = (data.docs || []).map(normalizeOpenLibrarySearchBook);

    for (const book of openLibraryBooks) {
      const key = book.googleBooks.info || `${normalizeText(book.title)}:${book.authors.map(normalizeText).join(",")}`;
      if (!candidates.has(key)) candidates.set(key, book);
    }
  } catch (error) {
    console.warn("Open Library title lookup failed:", error.message);
  }

  return selectBestMatch([...candidates.values()], title, author);
}
