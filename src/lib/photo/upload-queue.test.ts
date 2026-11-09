import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import { PhotoError, type preparePhoto } from "./prepare";
import { runUploadBatch, type UploadDeps, type UploadEntry } from "./upload-queue";

const HH = "hh";
const file = (name: string) => new File([name], name, { type: "image/jpeg" });

function setup(
  opts: {
    hashes?: Record<string, string>;
    prepareErrors?: Record<string, Error>;
    uploadFail?: (path: string, call: number) => boolean;
    createResult?: (call: number) => "created" | "duplicate" | Error;
    exists?: (hash: string) => boolean | Error;
    onCreatedThrows?: boolean;
  } = {},
) {
  const log: string[] = [];
  let n = 0;
  let uploadCalls = 0;
  let createCalls = 0;
  const creates: Record<string, unknown>[] = [];
  const sleeps: number[] = [];
  const deps: UploadDeps = {
    prepare: vi.fn(async (f: File) => {
      log.push(`prepare:${f.name}`);
      const err = opts.prepareErrors?.[f.name];
      if (err) throw err;
      return { blob: new Blob([f.name]), sourceHash: opts.hashes?.[f.name] ?? `hash-${f.name}` };
    }) as unknown as typeof preparePhoto,
    upload: vi.fn(async (path: string) => {
      uploadCalls += 1;
      log.push(`upload:${path}`);
      if (opts.uploadFail?.(path, uploadCalls)) throw new Error("net");
    }),
    create: vi.fn(async (row: Record<string, unknown>) => {
      createCalls += 1;
      log.push(`create:${row.id}`);
      creates.push(row);
      const r = opts.createResult?.(createCalls) ?? "created";
      if (r instanceof Error) throw r;
      return r;
    }) as unknown as UploadDeps["create"],
    exists: vi.fn(async (_hh: string, hash: string) => {
      const r = opts.exists?.(hash) ?? false;
      if (r instanceof Error) throw r;
      return r;
    }),
    newId: () => `id${++n}`,
    sleep: vi.fn(async (ms: number) => {
      sleeps.push(ms);
    }),
    onItemCreated: vi.fn((id: string) => {
      log.push(`created:${id}`);
      if (opts.onCreatedThrows) throw new Error("ui");
    }),
  };
  return { deps, log, creates, sleeps };
}

const base = { householdId: HH, ownerUserId: "u1", batchId: "b1" };

describe("runUploadBatch", () => {
  it("uploads and creates strictly in sequence", async () => {
    const { deps, log, creates } = setup();
    const res = await runUploadBatch([file("a"), file("b"), file("c")], { ...base, onChange: () => {} }, deps);
    expect(res.map((e) => e.state)).toEqual(["done", "done", "done"]);
    expect(log).toEqual([
      "prepare:a", "upload:hh/id1/cover.jpg", "create:id1", "created:id1",
      "prepare:b", "upload:hh/id2/cover.jpg", "create:id2", "created:id2",
      "prepare:c", "upload:hh/id3/cover.jpg", "create:id3", "created:id3",
    ]);
    expect(creates[0]).toMatchObject({
      id: "id1", householdId: HH, batchId: "b1", ownerUserId: "u1", titlePagePath: null,
    });
    expect(res[0].itemId).toBe("id1");
  });

  it("skips a same-selection duplicate without uploading", async () => {
    const { deps } = setup({ hashes: { a: "same", b: "same" } });
    const res = await runUploadBatch([file("a"), file("b")], { ...base, onChange: () => {} }, deps);
    expect(res.map((e) => e.state)).toEqual(["done", "duplicate"]);
    expect(deps.upload).toHaveBeenCalledTimes(1);
    expect(deps.create).toHaveBeenCalledTimes(1);
  });

  it("marks a create returning duplicate and continues", async () => {
    const { deps } = setup({ createResult: (c) => (c === 1 ? "duplicate" : "created") });
    const res = await runUploadBatch([file("a"), file("b")], { ...base, onChange: () => {} }, deps);
    expect(res.map((e) => e.state)).toEqual(["duplicate", "done"]);
    expect(deps.onItemCreated).toHaveBeenCalledTimes(1);
  });

  it("retries an upload with 2s and 8s backoff", async () => {
    const { deps, sleeps } = setup({ uploadFail: (_p, c) => c <= 2 });
    const res = await runUploadBatch([file("a")], { ...base, onChange: () => {} }, deps);
    expect(res[0].state).toBe("done");
    expect(sleeps).toEqual([2000, 8000]);
  });

  it("fails after four attempts, continues, and a re-run retries the failed file", async () => {
    const { deps, sleeps } = setup({ uploadFail: (_p, c) => c <= 4 });
    const a = file("a");
    const res = await runUploadBatch([a, file("b")], { ...base, onChange: () => {} }, deps);
    expect(res.map((e) => e.state)).toEqual(["failed", "done"]);
    expect(sleeps).toEqual([2000, 8000, 30000]);
    expect(deps.create).toHaveBeenCalledTimes(1);
    const again = await runUploadBatch([a], { ...base, onChange: () => {} }, deps);
    expect(again[0].state).toBe("done");
    expect(deps.create).toHaveBeenCalledTimes(2);
  });

  it("uploads the title page before create and records both paths", async () => {
    const { deps, log, creates } = setup();
    await runUploadBatch([file("a")], { ...base, titlePage: file("t"), onChange: () => {} }, deps);
    expect(log).toEqual([
      "prepare:a", "prepare:t", "upload:hh/id1/cover.jpg", "upload:hh/id1/title.jpg", "create:id1", "created:id1",
    ]);
    expect(creates[0]).toMatchObject({ coverPath: "hh/id1/cover.jpg", titlePagePath: "hh/id1/title.jpg" });
  });

  it("marks a PhotoError unreadable and keeps the code", async () => {
    const { deps } = setup({ prepareErrors: { a: new PhotoError("too_small") } });
    const res = await runUploadBatch([file("a"), file("b")], { ...base, onChange: () => {} }, deps);
    expect(res.map((e) => e.state)).toEqual(["unreadable", "done"]);
    expect(res[0].errorCode).toBe("too_small");
    expect(deps.upload).toHaveBeenCalledTimes(1);
  });

  it("marks a rejected create failed and continues", async () => {
    const { deps } = setup({ createResult: (c) => (c === 1 ? new Error("rls") : "created") });
    const res = await runUploadBatch([file("a"), file("b")], { ...base, onChange: () => {} }, deps);
    expect(res.map((e) => e.state)).toEqual(["failed", "done"]);
    expect(deps.onItemCreated).toHaveBeenCalledTimes(1);
  });

  it("reports each state transition", async () => {
    const { deps } = setup();
    const seen: string[] = [];
    await runUploadBatch([file("a")], { ...base, onChange: (es: UploadEntry[]) => seen.push(es[0].state) }, deps);
    expect(seen).toEqual(["queued", "preparing", "uploading", "done"]);
  });

  it("skips already-stored photos by hash with no upload or create", async () => {
    const { deps } = setup({ exists: (h) => h === "hash-a" });
    const res = await runUploadBatch([file("a"), file("b")], { ...base, onChange: () => {} }, deps);
    expect(res.map((e) => e.state)).toEqual(["duplicate", "done"]);
    expect(res[0].itemId).toBeNull();
    expect(deps.upload).toHaveBeenCalledTimes(1);
    expect(deps.create).toHaveBeenCalledTimes(1);
  });

  it("marks the entry failed when the exists check rejects, and continues", async () => {
    const { deps } = setup({ exists: (h) => (h === "hash-a" ? new Error("net") : false) });
    const res = await runUploadBatch([file("a"), file("b")], { ...base, onChange: () => {} }, deps);
    expect(res.map((e) => e.state)).toEqual(["failed", "done"]);
    expect(deps.upload).toHaveBeenCalledTimes(1);
  });

  it("leaves itemId null when the upload fails", async () => {
    const { deps } = setup({ uploadFail: () => true });
    const res = await runUploadBatch([file("a")], { ...base, onChange: () => {} }, deps);
    expect(res[0].itemId).toBeNull();
  });

  it("keeps a created entry done when onItemCreated throws", async () => {
    const { deps } = setup({ onCreatedThrows: true });
    const res = await runUploadBatch([file("a"), file("b")], { ...base, onChange: () => {} }, deps);
    expect(res.map((e) => e.state)).toEqual(["done", "done"]);
  });

  it("logs no error object or message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { deps } = setup({ createResult: () => new Error("Key (household_id, source_hash)=(x) path") });
    await runUploadBatch([file("a")], { ...base, onChange: () => {} }, deps);
    expect(JSON.stringify(spy.mock.calls)).not.toContain("household_id");
    spy.mockRestore();
  });
});
