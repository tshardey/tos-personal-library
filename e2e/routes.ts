import type { Page, Route } from "@playwright/test";

/**
 * Synthetic OpenLibrary and Google Books. Every title is invented and every ISBN is synthetic; no
 * request leaves the test browser for a real catalog.
 */

/** The one ISBN no catalog knows (valid checksum, synthetic). */
export const NOT_FOUND_ISBN = "9780000000040";

// Distinct invented titles and authors: two books by one author with near-identical titles are, by
// design, flagged as possible twins (P3), which would keep them out of bulk confirm.
const NAMED: Record<string, { title: string; author: string }> = {
  "9780000000002": { title: "The Lantern Keeper's Atlas", author: "Mira Okonkwo-Hale" },
  "9780000000019": { title: "Salt Roads of Vellmar", author: "Tobias Quillfeather" },
  "9791000000008": { title: "A Small Clockwork Winter", author: "Ines Dravenholt" },
  "9780000000026": { title: "Moth Lanterns at Low Tide", author: "Petra Wynnecombe" },
  "9780000000033": { title: "The Glass Orchard Ledger", author: "Callum Ashgrove" },
};
const FIRST = ["Amber", "Brindle", "Cinder", "Dusk", "Ember", "Fallow", "Gilded", "Hollow", "Ivory", "Juniper"];
const SECOND = ["Atlas", "Bastion", "Codex", "Delta", "Estuary", "Folio", "Garden", "Harbor", "Inlet", "Journal"];
const SURNAMES = ["Abernathy", "Brackwell", "Corrindale", "Dunmore", "Eastervale", "Fenwick", "Galloway", "Hartigan", "Ivesdon", "Jarrow"];

function bookFor(isbn: string): { title: string; author: string } {
  const named = NAMED[isbn];
  if (named) return named;
  const n = Number(isbn.slice(-3, -1));
  return {
    title: `The ${FIRST[n % 10]} ${SECOND[Math.floor(n / 10) % 10]} ${isbn.slice(-4)}`,
    author: `${FIRST[Math.floor(n / 10) % 10]} ${SURNAMES[n % 10]}`,
  };
}

export const titleFor = (isbn: string) => bookFor(isbn).title;

export interface CatalogRoutes {
  /** OpenLibrary ISBN searches answered so far (any status). */
  searches(): string[];
  /** The next `n` OpenLibrary calls answer 429. */
  rateLimitNext(n: number): void;
}

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

export async function routeCatalogs(page: Page): Promise<CatalogRoutes> {
  const searches: string[] = [];
  let limited = 0;

  await page.route(/^https:\/\/openlibrary\.org\//, async (route) => {
    const url = new URL(route.request().url());
    if (limited > 0) {
      limited--;
      if (url.pathname === "/search.json") searches.push(url.searchParams.get("isbn") ?? "");
      return json(route, { error: "rate limited" }, 429);
    }
    if (url.pathname === "/search.json") {
      const isbn = url.searchParams.get("isbn");
      searches.push(isbn ?? "");
      if (!isbn || isbn === NOT_FOUND_ISBN) return json(route, { numFound: 0, docs: [] });
      return json(route, {
        numFound: 1,
        docs: [
          {
            key: `/works/OL${isbn.slice(-6)}W`,
            title: bookFor(isbn).title,
            author_name: [bookFor(isbn).author],
            isbn: [isbn],
            number_of_pages_median: 123,
            first_publish_year: 2001,
            editions: { numFound: 1, docs: [{ key: `/books/OL${isbn.slice(-6)}M` }] },
          },
        ],
      });
    }
    if (url.pathname.startsWith("/works/")) {
      return json(route, { description: "An invented synopsis for an invented book." });
    }
    return json(route, {}, 404);
  });

  await page.route(/^https:\/\/www\.googleapis\.com\//, (route) => json(route, { totalItems: 0 }));
  await page.route(/^https:\/\/covers\.openlibrary\.org\//, (route) => route.fulfill({ status: 404, body: "" }));

  return {
    searches: () => [...searches],
    rateLimitNext(n) {
      limited = n;
    },
  };
}
