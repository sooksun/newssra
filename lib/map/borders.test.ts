import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import { deriveThaiSharedBorders, type BorderCountry } from "./borders";

test("deriveThaiSharedBorders keeps only segments shared with Thailand", () => {
  const countries: BorderCountry[] = [
    {
      name: "Thailand",
      nameTh: "ไทย",
      isThailand: true,
      label: [1, 1],
      rings: [
        [
          [0, 0],
          [2, 0],
          [2, 2],
          [0, 2],
          [0, 0],
        ],
      ],
    },
    {
      name: "Cambodia",
      nameTh: "กัมพูชา",
      isThailand: false,
      label: [3, 1],
      rings: [
        [
          [2, 2],
          [4, 2],
          [4, 0],
          [2, 0],
          [2, 2],
        ],
      ],
    },
    {
      name: "Vietnam",
      nameTh: "เวียดนาม",
      isThailand: false,
      label: [6, 1],
      rings: [
        [
          [5, 0],
          [7, 0],
          [7, 2],
          [5, 2],
          [5, 0],
        ],
      ],
    },
  ];

  const borders = deriveThaiSharedBorders(countries);

  assert.deepEqual(
    borders.map((border) => border.name),
    ["Cambodia"],
  );
  assert.equal(borders[0].segmentCount, 1);
  assert.deepEqual(borders[0].chains, [[[2, 0], [2, 2]]]);
});

test("bundled SEA polygons derive only Thailand land-border neighbors", () => {
  const doc = JSON.parse(
    readFileSync(join(process.cwd(), "public/geo/sea-borders.json"), "utf8"),
  ) as { countries: BorderCountry[] };

  const borders = deriveThaiSharedBorders(doc.countries);

  assert.deepEqual(
    borders.map((border) => border.name),
    ["Myanmar", "Laos", "Cambodia", "Malaysia"],
  );
  assert.deepEqual(
    Object.fromEntries(borders.map((border) => [border.name, border.segmentCount])),
    { Myanmar: 713, Laos: 599, Cambodia: 245, Malaysia: 167 },
  );
  assert.equal(borders.some((border) => border.name === "Vietnam"), false);
  assert.ok(borders.every((border) => border.chains.length > 0));
  assert.ok(
    borders.every((border) =>
      border.chains.every((chain) =>
        chain.length >= 2 &&
        chain.every(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat)),
      ),
    ),
  );
});
