import { normalizeIsbn } from "./book-matching.mjs";

const CATALOG_SEARCH_URL = "https://www.planetadelibros.com/blog/listas-y-tops-literarios";
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
  const wanted = normalizeIsbn(requestedIsbn);
  const records = getJsonLdBooks(html);
  const record = records.find((item) => {
    const ids = [item.isbn, item.productID, item.identifier]
      .flat()
      .filter((value) => typeof value === "string" || typeof value === "number");
    return ids.some((value) => normalizeIsbn(String(value)) === wanted);
  });

  const hasExactIsbn = Boolean(record) || normalizeIsbn(html).includes(wanted);
  if (!hasExactIsbn) return null;

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

/**
 * Last-resort lookup in the Spanish publisher catalog. A page is accepted only
 * if its structured data or visible ISBN explicitly matches the requested ISBN.
 */
export async function findSpanishCatalogBookByIsbn(isbn) {
  const url = new URL(CATALOG_SEARCH_URL);
  url.searchParams.set("textoBuscador", isbn);
  url.searchParams.set("details", "true");
  url.searchParams.set("pa", "1");
  url.searchParams.set("pb", "20");
  url.searchParams.set("pp", "20");

  try {
    const html = await fetchText(url.toString());
    const links = [...html.matchAll(/href=["']([^"'#?]*\/libro-[^"'#?]+\/\d+)["']/gi)]
      .map(([, path]) => new URL(path, "https://www.planetadelibros.com").toString());
    const candidates = [...new Set(links)].slice(0, 8);

    for (const pageUrl of candidates) {
      try {
        const page = await fetchText(pageUrl);
        const book = parseSpanishCatalogBook(page, isbn, pageUrl);
        if (book) return book;
      } catch (error) {
        console.warn("Spanish publisher catalog page lookup failed:", error.message);
      }
    }

    return null;
  } catch (error) {
    console.warn("Spanish publisher catalog ISBN lookup failed:", error.message);
    return null;
  }
}
