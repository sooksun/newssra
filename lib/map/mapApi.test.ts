// Unit tests ของชั้นเครือข่ายแผนที่ (lib/map/mapApi.ts) — ไม่ต้องมี DB/เครือข่ายจริง (mock global fetch)
// โฟกัสที่พฤติกรรมที่เคยพลาด: เรียก .json() ก่อนเช็คสถานะ ทำให้ HTML 502 กลายเป็น SyntaxError
// และการไม่ตั้งเพดานเวลา ทำให้สปินเนอร์บนแผนที่ค้างไม่รู้จบเมื่อเซิร์ฟเวอร์เส้นทางไม่ตอบ

import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { fetchOsrmRoutes } from "./mapApi";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function mockFetch(handler: (url: string, init: { signal?: AbortSignal }) => unknown) {
  globalThis.fetch = ((url: string, init: { signal?: AbortSignal } = {}) =>
    Promise.resolve(handler(url, init))) as unknown as typeof fetch;
}

describe("fetchOsrmRoutes", () => {
  test("ตอบ 200 ปกติ → คืนเส้นทาง", async () => {
    mockFetch(() => ({
      ok: true,
      status: 200,
      json: async () => ({
        code: "Ok",
        routes: [{ geometry: { coordinates: [[98.9, 18.7]] }, distance: 1234, duration: 300 }],
      }),
    }));
    const routes = await fetchOsrmRoutes(98.9, 18.7, 99.0, 18.8);
    assert.equal(routes.length, 1);
    assert.equal(routes[0].distanceM, 1234);
  });

  test("ตอบ 502 พร้อม body HTML → Error ที่บอกสถานะ ไม่ใช่ SyntaxError จาก JSON.parse", async () => {
    mockFetch(() => ({
      ok: false,
      status: 502,
      json: async () => {
        throw new SyntaxError("Unexpected token '<'");
      },
    }));
    await assert.rejects(
      () => fetchOsrmRoutes(98.9, 18.7, 99.0, 18.8),
      (e: unknown) => e instanceof Error && e.message.includes("502") && !(e instanceof SyntaxError),
    );
  });

  test("ตอบ 200 แต่ body ไม่ใช่ JSON → ข้อความอธิบายได้ ไม่ใช่ SyntaxError ดิบ", async () => {
    mockFetch(() => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token '<'");
      },
    }));
    await assert.rejects(
      () => fetchOsrmRoutes(98.9, 18.7, 99.0, 18.8),
      (e: unknown) => e instanceof Error && e.message.includes("อ่านไม่ได้"),
    );
  });

  test("code ไม่ใช่ Ok / ไม่มีเส้นทาง → Error ไม่พบเส้นทาง", async () => {
    mockFetch(() => ({ ok: true, status: 200, json: async () => ({ code: "NoRoute", routes: [] }) }));
    await assert.rejects(
      () => fetchOsrmRoutes(98.9, 18.7, 99.0, 18.8),
      (e: unknown) => e instanceof Error && e.message.includes("ไม่พบเส้นทาง"),
    );
  });

  test("ส่ง AbortSignal เสมอแม้ผู้เรียกไม่ได้ส่งมา (เพดานเวลา)", async () => {
    let seen: unknown;
    mockFetch((_url, init) => {
      seen = init.signal;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          code: "Ok",
          routes: [{ geometry: { coordinates: [[98.9, 18.7]] }, distance: 1, duration: 1 }],
        }),
      };
    });
    await fetchOsrmRoutes(98.9, 18.7, 99.0, 18.8);
    assert.ok(seen instanceof AbortSignal, "ต้องมี signal แม้ผู้เรียกไม่ส่ง");
  });

  test("signal ของผู้เรียกถูก abort → คำขอถูกยกเลิกด้วย (รวมกับ timeout ไม่ทับกัน)", async () => {
    const controller = new AbortController();
    let seen: AbortSignal | undefined;
    mockFetch((_url, init) => {
      seen = init.signal;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          code: "Ok",
          routes: [{ geometry: { coordinates: [[98.9, 18.7]] }, distance: 1, duration: 1 }],
        }),
      };
    });
    await fetchOsrmRoutes(98.9, 18.7, 99.0, 18.8, { signal: controller.signal });
    assert.ok(seen instanceof AbortSignal);
    assert.equal(seen?.aborted, false);
    controller.abort();
    assert.equal(seen?.aborted, true, "abort ของผู้เรียกต้องส่งผลถึง signal ที่ใช้จริง");
  });
});
