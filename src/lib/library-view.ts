import type { CoverFilter } from "@/lib/covers/eligibility";
import type { OwnerFilter } from "@/lib/filter-books";

export interface LibraryView {
  query: string;
  owner: OwnerFilter;
  edition: string | null;
  tags: string[];
  coverFilter: CoverFilter;
  unhauled: boolean;
  deluxe: boolean;
  signed: boolean;
  addedDay: string | null;
  publishedFrom: number | null;
  publishedTo: number | null;
}

export const DEFAULT_VIEW: LibraryView = {
  query: "",
  owner: "all",
  edition: null,
  tags: [],
  coverFilter: "all",
  unhauled: false,
  deluxe: false,
  signed: false,
  addedDay: null,
  publishedFrom: null,
  publishedTo: null,
};
