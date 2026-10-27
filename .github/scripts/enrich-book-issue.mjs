import { readFile } from "node:fs/promises";

const API = "https://www.googleapis.com/books/v1/volumes";
const OPEN_LIBRARY = "https://openlibrary.org";
const USER_AGENT = "soker90-libros/1.0 (GitHub Actions)";

const normalize = (value = "") =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const isbnDigits = (value) => value.replace(/[^0-9Xx]/g, "").toUpperCase();

function isValidIsbn(value) {
  const isbn = isbnDigits(value);
  if (/^\d{13}$/.test(isbn)) {
    const sum = [...isbn].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0);
    return sum % 10 === 0;
  }
  if (/^\d{9}[\dX]$/.test(isbn)) {
    const sum = [...isbn].reduce((total, digit, index) => total + (digit === "X" ? 10 : Number(digit)) * (10 - index), 0);
    return sum % 11 === 0;
  }
  return false;
}

function extractIsbn(text) {
  const matches = text.match(/(?:97[89][\s-]?(?:\d[\s-]?){10}|\d[\s-]?(?:\d[\s-]?){8}[\dXx])/g) || [];
  return matches.map(isbnDigits).find(isValidIsbn) || "";
}

function extractAuthor(body = "") {
  const match = body.match(/^\s*(?:author|autor|by|escrito por)\s*:\s*(.+?)\s*$/im);
  return match?.[1]?.trim() || "";
}

function stripIsbn(title, isbn) {
  if (!isbn) return title.trim();
  return title.replace(new RegExp(isbn.replace(/[-]/g, "[-\\s]?"), "i"), "").replace(/[()[\]{}]/g, " ").replace(/\s+/g, " ").trim();
}

function titleScore(expected, candidate) {
  const a = normalize(expected);
  const b = normalize(candidate);
  if (!a || !b) return 0;
  if (a === b) return 12;
  if (b.includes(a) || a.includes(b)) return 7;
  const aWords = new Set(a.split(" ").filter((word) => word.length > 1));
  const bWords = new Set(b.split(" ").filter((word) => word.length > 1));
  const overlap = [...aWords].filter((word) => bWords.has(word)).length;
  return aWords.size ? (overlap / aWords.size) * 6 : 0;
}

function authorScore(expected, authors = []) {
  if (!expected) return 0;
  const wanted = normalize(expected);
  return authors.some((author) => {
    const actual = normalize(author);
    return actual === wanted || actual.includes(wanted) || wanted.includes(actual);
  }) ? 7 : -3;
}

function getIsbns(identifiers = []) {
  return {
    isbn10: identifiers.find((item) => item.type === "ISBN_10")?.identifier,
    isbn13: identifiers.find((item) => item.type === "ISBN_13")?.identifier,
  };
}

function googleCandidate(item) {
  const info = item.volumeInfo || {};
  const identifiers = getIsbns(info.industryIdentifiers || []);
  const image = info.imageLinks?.thumbnail?.replace(/^http:/, "https:") || "";
  return {
    title: info.title || "",
    authors: info.authors || [],
    publisher: info.publisher || "",
    publishedDate: info.publishedDate || "",
    description: info.description || "",
    image,
    language: info.language || "",
    averageRating: info.averageRating || 0,
    ratingsCount: info.ratingsCount || 0,
    categories: info.categories || [],
    pageCount: info.pageCount || 0,
    ...identifiers,
    googleBooks: {
      id: item.id || "",
      preview: info.previewLink || "",
      info: info.infoLink || "",
      canonical: info.canonicalVolumeLink || "",
    },
  };
}

function isbnMatches(book, isbn) {
  return [book.isbn10, book.isbn13].some((candidate) => candidate && isbnDigits(candidate) === isbnDigits(isbn));
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
  if (!response.ok) throw new Error(`Request failed (${response.status}) for ${url}`);
  return response.json();
}

async function searchGoogle(query) {
  const data = await fetchJson(`${API}?q=${encodeURIComponent(query)}&maxResults=20&printType=books`);
  return (data.items || []).map(googleCandidate);
}

async function findByIsbn(isbn) {
  try {
    const results = await searchGoogle(`isbn:${isbn}`);
    const exact = results.find((book) => isbnMatches(book, isbn));
    if (exact) return exact;
  } catch (error) {
    console.warn("Google Books ISBN lookup failed:", error.message);
  }

  try {
    const key = `ISBN:${isbn}`;
    const data = await fetchJson(`${OPEN_LIBRARY}/api/books?bibkeys=${encodeURIComponent(key)}&format=json&jscmd=data`);
    const item = data[key];
    if (!item) return null;
    const identifiers = item.identifiers || {};
    const isbn10 = identifiers.isbn_10?.[0] || (/^\d{9}[\dX]$/.test(isbn) ? isbn : undefined);
    const isbn13 = identifiers.isbn_13?.[0] || (/^\d{13}$/.test(isbn) ? isbn : undefined);
    const cover = item.cover?.large || item.cover?.medium || item.cover?.small || "";
    return {
      title: item.title || "",
      authors: (item.authors || []).map((author) => author.name).filter(Boolean),
      publisher: (item.publishers || []).map((publisher) => publisher.name).filter(Boolean).join(", "),
      publishedDate: item.publish_date || "",
      description: typeof item.notes === "string" ? item.notes : "",
      image: cover.replace(/^http:/, "https:"),
      language: "",
      averageRating: 0,
      ratingsCount: 0,
      categories: (item.subjects || []).map((subject) => subject.name).filter(Boolean),
      pageCount: item.number_of_pages || 0,
      isbn10,
      isbn13,
      googleBooks: {
        id: "",
        preview: item.url || "",
        info: item.url || "",
        canonical: item.url || "",
      },
    };
  } catch (error) {
    console.warn("Open Library ISBN lookup failed:", error.message);
  }
  return null;
}

async function findByTitle(title, author) {
  const queries = [
    `intitle:${title}${author ? `+inauthor:${author}` : ""}`,
    `"${title}"${author ? `+${author}` : ""}`,
  ];
  const candidates = new Map();
  for (const query of queries) {
    try {
      for (const book of await searchGoogle(query)) {
        const key = book.googleBooks.id || `${normalize(book.title)}:${book.authors.map(normalize).join(",")}`;
        candidates.set(key, book);
      }
    } catch (error) {
      console.warn("Google Books title lookup failed:", error.message);
    }
  }
  const ranked = [...candidates.values()]
    .map((book) => ({ book, score: titleScore(title, book.title) + authorScore(author, book.authors) }))
    .sort((left, right) => right.score - left.score);
  const best = ranked[0];
  if (!best || best.score < (author ? 10 : 8)) return null;
  return best.book;
}

function slugify(value) {
  return normalize(value).replace(/\s+/g, "-").slice(0, 40);
}

async function githubRequest(path, token, options = {}) {
  const response = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function ensureLabel(name, token) {
  try {
    await githubRequest("/labels", token, {
      method: "POST",
      body: JSON.stringify({ name, color: "ededed" }),
    });
  } catch (error) {
    // A 422 means the label already exists. Other errors are surfaced.
    if (!String(error.message).includes("422")) throw error;
  }
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!token || !eventPath || !process.env.GITHUB_REPOSITORY) {
    throw new Error("GITHUB_TOKEN, GITHUB_EVENT_PATH and GITHUB_REPOSITORY are required");
  }
  const event = JSON.parse(await readFile(eventPath, "utf8"));
  const issue = event.issue;
  if (!issue?.number) throw new Error("This workflow did not receive an issue event");

  const titleIsbn = extractIsbn(issue.title || "");
  const isbn = titleIsbn || extractIsbn(issue.body || "");
  const title = stripIsbn(issue.title || "", isbn);
  const author = extractAuthor(issue.body || "");
  if (!title) throw new Error("The issue title is empty after removing the ISBN");

  let book = isbn ? await findByIsbn(isbn) : null;
  if (isbn && !book) {
    throw new Error(`No exact edition found for ISBN ${isbn}. No unrelated edition or cover was selected; add the book details manually or retry later.`);
  }
  if (!book) book = await findByTitle(title, author);
  if (!book) {
    throw new Error(`No sufficiently reliable match found for "${title}"${author ? ` by ${author}` : ""}. Please add an ISBN or an "Author: Name" line to the issue body.`);
  }

  if (!book.image) book.image = "https://placehold.co/128x196?text=No+cover";
  const labels = [
    "kind: book",
    `started: ${new Date().toLocaleString("en", { month: "long", timeZone: "UTC" }).toLowerCase()}`,
    `started: ${new Date().getUTCFullYear()}`,
    ...book.authors.map((name) => `author: ${slugify(name)}`),
    ...book.categories.map((name) => `category: ${slugify(name)}`),
  ];
  if (book.publishedDate) {
    const year = Number(book.publishedDate.slice(0, 4));
    if (Number.isFinite(year) && year > 0) labels.push(`year: ${year}`, `decade: ${Math.floor(year / 10) * 10}s`);
  }
  if (book.language) labels.push(`language: ${slugify(book.language)}`);
  if (book.publisher) labels.push(`publisher: ${slugify(book.publisher)}`);

  const details = { ...book, ...(isbn ? { requestedIsbn: isbn } : {}), metadataSource: isbn && book.isbn10 && isbnDigits(book.isbn10) === isbn ? "Google Books/Open Library ISBN match" : "Google Books title/author match" };
  const sourceName = book.googleBooks?.id ? "Google Books" : "Open Library";
  const comment = [
    "<!-- This comment is autogenerated by the Libros metadata resolver -->",
    "",
    `Book match: **${book.title}** by ${book.authors.join(", ") || "unknown author"}.`,
    isbn ? `Matched using ISBN ${isbn}.` : `Matched using title${author ? " and author" : ""}; please verify the edition.`,
    book.image.includes("placehold.co") ? "No cover was found in the metadata providers; a neutral placeholder is used." : "",
    book.googleBooks?.info ? `Source: [${sourceName}](${book.googleBooks.info}).` : book.googleBooks?.canonical ? `Source: [${sourceName}](${book.googleBooks.canonical}).` : "",
    "",
    "<details>",
    "<summary>Book details (JSON)</summary>",
    "",
    "```json",
    JSON.stringify(details, null, 2),
    "```",
    "",
    "</details>",
    "",
    "When you finish reading, close this issue to mark it as completed. 👍",
  ].filter(Boolean).join("\n");

  await githubRequest(`/issues/${issue.number}/comments`, token, { method: "POST", body: JSON.stringify({ body: comment }) });
  for (const label of labels) {
    const safe = label.length > 50 ? `${label.slice(0, 47)}...` : label;
    await ensureLabel(safe, token);
  }
  await githubRequest(`/issues/${issue.number}/labels`, token, { method: "POST", body: JSON.stringify({ labels: labels.map((label) => label.length > 50 ? `${label.slice(0, 47)}...` : label) }) });
  await githubRequest(`/issues/${issue.number}/lock`, token, { method: "PUT", body: JSON.stringify({ lock_reason: "resolved" }) });
  console.log(`Resolved issue #${issue.number} to "${book.title}"${isbn ? ` using ISBN ${isbn}` : ""}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
