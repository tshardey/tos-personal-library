import { useEffect, useRef, useState } from "react";
import { isbnFromTyped } from "@/lib/scan/isbn-input";

interface Props {
  /** A valid ISBN-13 (an ISBN-10 is converted); the parent closes the sheet. */
  onAdd(isbn13: string): void;
  onClose(): void;
}

export default function TypeIsbnSheet({ onAdd, onClose }: Props) {
  const [text, setText] = useState("");
  const [invalid, setInvalid] = useState(false);
  const fieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fieldRef.current?.focus();
  }, []);

  function submit() {
    const isbn13 = isbnFromTyped(text);
    if (isbn13 === null) {
      setInvalid(true);
      return;
    }
    onAdd(isbn13);
  }

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Type ISBN"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
        className="w-full max-w-lg rounded-t bg-white p-4 text-stone-900 sm:rounded"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label htmlFor="scan-typed-isbn" className="mb-1 block text-sm">
            ISBN
          </label>
          <input
            ref={fieldRef}
            id="scan-typed-isbn"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setInvalid(false);
            }}
            className="mb-2 block w-full rounded border p-2"
          />
          {invalid && <p className="mb-2 text-sm text-red-700">That isn't a valid ISBN. Check the digits.</p>}
          <div className="flex gap-2">
            <button type="submit" className="rounded bg-stone-800 px-3 py-2 text-white">
              Add
            </button>
            <button type="button" onClick={onClose} className="rounded border px-3 py-2">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
