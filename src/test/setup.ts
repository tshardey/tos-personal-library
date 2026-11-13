import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { clearCatalogCache } from "@/lib/catalog-cache";
import { resetLibraryView } from "@/lib/library-view";

// D9: the view store and the catalogue cache outlive components, so no test leaks into the next.
afterEach(() => {
  clearCatalogCache();
  resetLibraryView();
});
