import { equivalentIsbns, normalizeIsbn } from "./book-matching.mjs";

const CATALOG_SEARCH_URL = "https://www.planetadelibros.com/buscar";
const USER_AGENT = "soker90-libros/1.0 (GitHub Actions)";

function decodeHtml(value = "") {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function stripTags(value = "") {
  return decodeHtml(value.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function getMeta(html, property) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(
    `<meta\\b[^>]*(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']*)["'][^>]*>`,
    "i",
  )) || html.match(new RegExp(
    `<meta\\b[^>]*content=["']([^"']*)["'][^>]*(?:property|name)=["']${escaped}["'][^>]*>`,
    "i",
  ));
  return decodeHtml(match?.[1] || "");
}

function getJsonLdBooks(html) {
  const scripts = [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const records = [];

  for (const [, raw] of scripts) {
    try {
      const parsed = JSON.parse(raw);
      const values = Array.isArray(parsed) ? parsed : [parsed];
      for (const value of values) {
        records.push(...(Array.isArray(value["@graph"]) ? value["@graph"] : [value]));
      }
    } catch {
      // Ignore malformed or unrelated structured data.
    }
  }

  return records;
}

/** Parse a publisher-catalog page only when it explicitly contains the requested ISBN. */
export function parseSpanishCatalogBook(html, requestedIsbn, sourceUrl) {
  const wantedForms = equivalentIsbns(requestedIsbn);
  const records = getJsonLdBooks(html);
  const record = records.find((item) => {
    const ids = [item.isbn, item.productID, item.identifier]
      .flat()
      .filter((value) => typeof value === "string" || typeof value === "number");
    return ids.some((value) => wantedForms.includes(normalizeIsbn(String(value))));
  });

  const normalizedHtml = normalizeIsbn(html);
  const hasExactIsbn = Boolean(record) || wantedForms.some((candidate) => normalizedHtml.includes(candidate));
  if (!hasExactIsbn) return null;
  const wanted = normalizeIsbn(requestedIsbn);

  const title = record?.name || stripTags(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "") || getMeta(html, "og:title");
  if (!title) return null;

  const rawAuthor = record?.author;
  const authors = (Array.isArray(rawAuthor) ? rawAuthor : rawAuthor ? [rawAuthor] : [])
    .map((author) => typeof author === "string" ? author : author.name)
    .filter(Boolean);
  if (!authors.length) {
    const authorLink = html.match(/<a\b[^>]*href=["'][^"']*autor[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
    if (authorLink) authors.push(stripTags(authorLink[1]));
  }

  const image = record?.image
    ? (typeof record.image === "string" ? record.image : record.image.url || "")
    : getMeta(html, "og:image");
  const description = record?.description || getMeta(html, "og:description");
  const publisher = typeof record?.publisher === "string"
    ? record.publisher
    : record?.publisher?.name || "";
  const date = record?.datePublished || "";
  const isbn10 = /^\d{9}[\dX]$/.test(wanted) ? wanted : undefined;
  const isbn13 = /^\d{13}$/.test(wanted) ? wanted : undefined;

  return {
    title: stripTags(title),
    authors,
    publisher,
    publishedDate: String(date),
    description: stripTags(description),
    image: image.replace(/^http:/, "https:"),
    language: "es",
    averageRating: 0,
    ratingsCount: 0,
    categories: [],
    pageCount: Number(record?.numberOfPages) || 0,
    isbn10,
    isbn13,
    googleBooks: { id: "", preview: sourceUrl, info: sourceUrl, canonical: sourceUrl },
  };
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
  });
  if (!response.ok) throw new Error(`Request failed (${response.status}) for ${url}`);
  return response.text();
}

function extractPublisherLinks(html) {
  const decoded = decodeHtml(html).replace(/\\u0026/g, "&").replace(/\\\//g, "/");
  const links = [...decoded.matchAll(/(?:href|url)=["']([^"'<>]+)["']/gi)]
    .map(([, value]) => {
      let candidate = value;
      try {
        const parsed = new URL(candidate, "https://www.planetadelibros.com");
        if (parsed.pathname === "/url" && (parsed.hostname.includes("google.") || parsed.hostname === "www.planetadelibros.com")) {
          candidate = parsed.searchParams.get("q") || parsed.searchParams.get("url") || candidate;
        }
      } catch {
        // Ignore malformed links.
      }
      try {
        const parsed = new URL(candidate, "https://www.planetadelibros.com");
        if (parsed.hostname === "www.planetadelibros.com" && /\/libro-[^/]+\/\d+\/?$/.test(parsed.pathname)) {
          return parsed.toString();
        }
      } catch {
        // Ignore malformed links.
      }
      return "";
    })
    .filter(Boolean);
  return [...new Set(links)];
}

/**
 * Last-resort lookup in the Spanish publisher catalog. A page is accepted only
 * if its structured data or visible ISBN explicitly matches the requested ISBN.
 */
export async function findSpanishCatalogBookByIsbn(isbn) {
  const identifiers = equivalentIsbns(isbn);
  const searchUrls = [];
  for (const key of ["textoBuscador", "q", "query", "search", "isbn"]) {
    const url = new URL(CATALOG_SEARCH_URL);
    url.searchParams.set(key, isbn);
    url.searchParams.set("details", "true");
    url.searchParams.set("pa", "1");
    url.searchParams.set("pb", "20");
    url.searchParams.set("pp", "20");
    searchUrls.push(url.toString());
  }
  for (const identifier of identifiers) {
    searchUrls.push("https://www.google.com/search?q=" + encodeURIComponent("site:planetadelibros.com/libro- " + identifier));
  }

  const candidates = [];
  for (const searchUrl of searchUrls) {
    try {
      candidates.push(...extractPublisherLinks(await fetchText(searchUrl)));
    } catch (error) {
      console.warn("Spanish publisher catalog search failed:", error.message);
    }
    if (candidates.length >= 12) break;
  }

  for (const pageUrl of [...new Set(candidates)].slice(0, 12)) {
    try {
      const page = await fetchText(pageUrl);
      const book = parseSpanishCatalogBook(page, isbn, pageUrl);
      if (book) return book;
    } catch (error) {
      console.warn("Spanish publisher catalog page lookup failed:", error.message);
    }
  }

  console.warn("Spanish publisher catalog returned no exact match for ISBN " + isbn + " after checking " + candidates.length + " candidate links.");
  return null;
}
