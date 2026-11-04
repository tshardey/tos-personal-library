import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import BookCard from "./BookCard";
import type { BookWithCopies } from "@/lib/types";

function make(coverUrl: string | null): BookWithCopies {
  return {
    id: "b1",
    householdId: "h",
    title: "Slewfoot",
    authors: ["Brom", "Other"],
    synopsis: null,
    coverUrl,
    isbn13: [],
    isbn10: [],
    openlibraryId: null,
    googleBooksId: null,
    pageCount: null,
    publisher: null,
    publishDate: null,
    userEditedFields: [],
    createdAt: "",
    updatedAt: "",
    copies: [],
  };
}

describe("BookCard", () => {
  it("renders a placeholder with title and first author when there is no cover", () => {
    render(<BookCard book={make(null)} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("Slewfoot")).toBeInTheDocument();
    expect(screen.getByText("Brom")).toBeInTheDocument();
    expect(screen.queryByText("Other")).not.toBeInTheDocument();
  });
  it("renders the cover image when present", () => {
    render(<BookCard book={make("http://x/c.jpg")} />);
    expect(screen.getByAltText("Slewfoot cover")).toHaveAttribute("src", "http://x/c.jpg");
  });
});
