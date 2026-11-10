import { describe, expect, it } from "vitest";
import { createReadGate, idleDue, nudgeDue, REPEAT_WINDOW_MS } from "./read-gate";

const ISBN = "9780000000002";
const OTHER = "9780000000019";
const none = new Set<string>();

describe("createReadGate (Review Focus 1)", () => {
  it("adds a first read", () => {
    expect(createReadGate().onBarcode(ISBN, 0, none)).toEqual({ kind: "add", isbn13: ISBN });
  });

  it("ignores a barcode held in view for 10 s, then asks or adds after a 3 s gap", () => {
    for (const session of [new Set([ISBN]), none]) {
      const gate = createReadGate();
      expect(gate.onBarcode(ISBN, 0, none).kind).toBe("add");
      for (let t = 100; t <= 10000; t += 100) {
        expect(gate.onBarcode(ISBN, t, session)).toEqual({ kind: "ignored" });
      }
      const expected = session.has(ISBN) ? "ask_another_copy" : "add";
      expect(gate.onBarcode(ISBN, 13100, session)).toEqual({ kind: expected, isbn13: ISBN });
    }
  });

  it("slides the window on every read, even an ignored one", () => {
    const gate = createReadGate();
    expect(gate.onBarcode(ISBN, 0, none).kind).toBe("add");
    expect(gate.onBarcode(ISBN, 2999, none)).toEqual({ kind: "ignored" });
    expect(gate.onBarcode(ISBN, 5998, none)).toEqual({ kind: "ignored" });
    expect(REPEAT_WINDOW_MS).toBe(3000);
  });

  it("turns a UPC and a bad checksum into not_isbn", () => {
    const gate = createReadGate();
    expect(gate.onBarcode("0012345678905", 0, none)).toEqual({ kind: "not_isbn" });
    expect(gate.onBarcode("9780000000003", 0, none)).toEqual({ kind: "not_isbn" });
  });

  it("adds two different books in quick succession", () => {
    const gate = createReadGate();
    expect(gate.onBarcode(ISBN, 0, none).kind).toBe("add");
    expect(gate.onBarcode(OTHER, 100, none)).toEqual({ kind: "add", isbn13: OTHER });
  });

  it("treats an add-on read as the same ISBN", () => {
    const gate = createReadGate();
    expect(gate.onBarcode(ISBN, 0, none).kind).toBe("add");
    expect(gate.onBarcode(`${ISBN}51299`, 500, none)).toEqual({ kind: "ignored" });
  });

  it("asks at once for a typed ISBN already in the session", () => {
    const gate = createReadGate();
    expect(gate.onBarcode(ISBN, 0, none).kind).toBe("add");
    expect(gate.onTyped(ISBN, new Set([ISBN]))).toEqual({ kind: "ask_another_copy", isbn13: ISBN });
    expect(gate.onTyped(OTHER, new Set([ISBN]))).toEqual({ kind: "add", isbn13: OTHER });
  });
});

describe("nudgeDue / idleDue", () => {
  it("is due after 8 s and 120 s", () => {
    expect(nudgeDue(8000, 0)).toBe(true);
    expect(nudgeDue(7999, 0)).toBe(false);
    expect(idleDue(120000, 0)).toBe(true);
    expect(idleDue(119999, 0)).toBe(false);
  });
});
