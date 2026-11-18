import { BottomBar } from "@/components/ui";
import type { BookWithCopies } from "@/lib/types";
import CoverBatch from "./CoverBatch";

/** `books` is the visible, filtered set. Fixed at the bottom, like the bulk confirm sheet's footer. */
export default function CoverBatchFooter({ books }: { books: BookWithCopies[] }) {
  return (
    <BottomBar>
      <div className="mx-auto max-w-3xl">
        <CoverBatch books={books} />
      </div>
    </BottomBar>
  );
}
