import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { analyzeTerrainFromImages, parseTerrainResponse, TerrainAnalysisError } from "./terrainAnalysis";

describe("parseTerrainResponse", () => {
  test("ผลถูกต้อง → คืนค่า", () => {
    const out = parseTerrainResponse({
      settingType: "ภูเขาสูง",
      rationale: "ภาพแสดงยอดเขาสูงชันล้อมรอบ",
      confidence: "high",
    });
    assert.equal(out.settingType, "ภูเขาสูง");
    assert.equal(out.confidence, "high");
    assert.ok(out.rationale.includes("ยอดเขา"));
  });
  test("settingType นอก enum → throw bad-content", () => {
    assert.throws(
      () => parseTerrainResponse({ settingType: "ดาวอังคาร", rationale: "x", confidence: "high" }),
      (e: unknown) => e instanceof TerrainAnalysisError && e.code === "bad-content",
    );
  });
  test("confidence ผิดค่า → throw bad-content", () => {
    assert.throws(
      () => parseTerrainResponse({ settingType: "เกาะ", rationale: "x", confidence: "สูงมาก" }),
      (e: unknown) => e instanceof TerrainAnalysisError && e.code === "bad-content",
    );
  });
  test("rationale ยาวเกิน 500 → cap", () => {
    const out = parseTerrainResponse({ settingType: "หุบเขา", rationale: "ก".repeat(800), confidence: "low" });
    assert.equal(out.rationale.length, 500);
  });
  test("ไม่ใช่ object / ขาด field → throw bad-content", () => {
    assert.throws(
      () => parseTerrainResponse(null),
      (e: unknown) => e instanceof TerrainAnalysisError,
    );
    assert.throws(
      () => parseTerrainResponse({ settingType: "เกาะ" }),
      (e: unknown) => e instanceof TerrainAnalysisError,
    );
  });
});

describe("analyzeTerrainFromImages — เพดานเวลารอ upstream", () => {
  const realFetch = globalThis.fetch;
  const realKey = process.env.OPENROUTER_API_KEY;

  afterEach(() => {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = realKey;
  });

  const images = [{ buffer: Buffer.from([0xff, 0xd8, 0xff]), viewLabel: "มุมบน", mimeType: "image/jpeg" }];

  test("ส่ง AbortSignal ไปกับคำขอเสมอ (ถ้าไม่ส่ง upstream ค้างจะรอไม่จำกัด)", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    let seenSignal: unknown;
    globalThis.fetch = (async (_url: unknown, init: { signal?: AbortSignal }) => {
      seenSignal = init?.signal;
      return {
        status: 200,
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({ settingType: "เกาะ", rationale: "ล้อมรอบด้วยน้ำ", confidence: "high" }),
              },
            },
          ],
        }),
      };
    }) as unknown as typeof fetch;

    const out = await analyzeTerrainFromImages(images);
    assert.equal(out.settingType, "เกาะ");
    assert.ok(seenSignal instanceof AbortSignal, "ต้องส่ง signal ไปกับ fetch");
  });

  test("upstream หมดเวลา (TimeoutError) → TerrainAnalysisError code=upstream พร้อมข้อความบอกว่าหมดเวลา", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    globalThis.fetch = (async () => {
      const err = new Error("The operation was aborted due to timeout");
      err.name = "TimeoutError";
      throw err;
    }) as unknown as typeof fetch;

    await assert.rejects(
      () => analyzeTerrainFromImages(images),
      (e: unknown) => e instanceof TerrainAnalysisError && e.code === "upstream" && e.message.includes("นานเกิน"),
    );
  });
});
