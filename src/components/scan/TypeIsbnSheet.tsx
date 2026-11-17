import { useRef, useState } from "react";
import { isbnFromTyped } from "@/lib/scan/isbn-input";
import { Button, Sheet } from "../ui";

interface Props {
  /** A valid ISBN-13 (an ISBN-10 is converted); the parent closes the sheet. */
  onAdd(isbn13: string): void;
  onClose(): void;
}

export default function TypeIsbnSheet({ onAdd, onClose }: Props) {
  const [text, setText] = useState("");
  const [invalid, setInvalid] = useState(false);
  const fieldRef = useRef<HTMLInputElement>(null);

  function submit() {
    const isbn13 = isbnFromTyped(text);
    if (isbn13 === null) {
      setInvalid(true);
      return;
    }
    onAdd(isbn13);
  }

  return (
    <Sheet label="Type ISBN" onClose={onClose} initialFocus={fieldRef}>
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
          className="mb-2 block min-h-11 w-full rounded-md border border-field bg-control px-3 text-sm text-fg sm:min-h-9"
        />
        {invalid && <p className="mb-2 text-sm text-danger">That isn't a valid ISBN. Check the digits.</p>}
        <div className="flex gap-2">
          <Button type="submit" variant="primary">
            Add
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Sheet>
  );
}
