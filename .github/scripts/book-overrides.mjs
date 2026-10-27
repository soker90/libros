import { equivalentIsbns, normalizeIsbn } from "./book-matching.mjs";

// Human-verified edition records for ISBNs whose upstream APIs are unavailable.
// Keep the source URL and exact ISBNs with every record; never match by title alone.
const VERIFIED_BOOK_OVERRIDES = [
  {
    isbn10: "8445018914",
    isbn13: "9788445018910",
    title: "Ciclo Pendragon nº 02/06 Merlín",
    authors: ["Stephen R. Lawhead"],
    publisher: "Minotauro",
    publishedDate: "2025-07-02",
    description: "Merlín deberá hacer realidad el Reino del Verano y superar duras pruebas que pondrán a prueba su espíritu, su cuerpo y su mente.",
    image: "https://www.planetadelibros.com/usuaris/libros/fotos/405/original/portada_ciclo-pendragon-n-0206-merlin_stephen-r-lawhead_202505280841.jpg",
    language: "es",
    averageRating: 0,
    ratingsCount: 0,
    categories: ["Fantasía"],
    pageCount: 480,
    googleBooks: {
      id: "",
      preview: "https://www.planetadelibros.com/libro-ciclo-pendragon-n-0206-merlin/404233",
      info: "https://www.planetadelibros.com/libro-ciclo-pendragon-n-0206-merlin/404233",
      canonical: "https://www.planetadelibros.com/libro-ciclo-pendragon-n-0206-merlin/404233",
    },
  },
];

/** Return only a manually verified record whose ISBN-10/13 is equivalent. */
export function findVerifiedBookOverride(isbn) {
  const wanted = equivalentIsbns(isbn);
  const book = VERIFIED_BOOK_OVERRIDES.find((candidate) =>
    [candidate.isbn10, candidate.isbn13]
      .map(normalizeIsbn)
      .some((identifier) => wanted.includes(identifier)),
  );
  return book ? structuredClone(book) : null;
}
