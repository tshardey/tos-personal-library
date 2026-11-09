import { fireEvent, render, screen } from "@testing-library/react";
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
    const ph = screen.getByTestId("cover-placeholder");
    expect(ph).toHaveTextContent("Slewfoot");
    expect(ph).toHaveTextContent("Brom");
    expect(screen.queryByText("Other")).not.toBeInTheDocument();
  });
  it("renders the cover image when present, with visible title and first author", () => {
    render(<BookCard book={make("http://x/c.jpg")} />);
    expect(screen.getByAltText("Slewfoot cover")).toHaveAttribute("src", "http://x/c.jpg");
    expect(screen.getByText("Slewfoot")).toBeVisible();
    expect(screen.getByText("Brom")).toBeVisible();
    expect(screen.queryByText("Other")).not.toBeInTheDocument();
  });
  it("falls back to the placeholder when the cover fails to load", () => {
    render(<BookCard book={make("http://x/broken.jpg")} />);
    fireEvent.error(screen.getByAltText("Slewfoot cover"));
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    const ph = screen.getByTestId("cover-placeholder");
    expect(ph).toHaveTextContent("Slewfoot");
    expect(ph).toHaveTextContent("Brom");
  });
  it("shows our copy's photo when there is no stock cover", () => {
    render(<BookCard book={make(null)} photoUrl="http://x/p.jpg" />);
    expect(screen.getByAltText("Slewfoot, photo of our copy")).toHaveAttribute("src", "http://x/p.jpg");
    expect(screen.queryByTestId("cover-placeholder")).not.toBeInTheDocument();
  });
  it("prefers the stock cover over the photo", () => {
    render(<BookCard book={make("http://x/c.jpg")} photoUrl="http://x/p.jpg" />);
    expect(screen.getByAltText("Slewfoot cover")).toBeInTheDocument();
    expect(screen.queryByAltText("Slewfoot, photo of our copy")).not.toBeInTheDocument();
  });
  it("falls back to the photo when the stock cover fails to load", () => {
    render(<BookCard book={make("http://x/broken.jpg")} photoUrl="http://x/p.jpg" />);
    fireEvent.error(screen.getByAltText("Slewfoot cover"));
    expect(screen.getByAltText("Slewfoot, photo of our copy")).toBeInTheDocument();
  });
});
