// ===== Tests for Meshcore Tile Generator =====
// Run with: bun test

import { describe, it, expect } from "bun:test";
import {
  range,
  lon2tilex,
  lat2tiley,
  computeTileBounds,
  countTiles,
  enumerateTiles,
  computeTotalTiles,
} from "./index";

// ------ range() tests - -----

describe("range()", () => {
  it("should generate a range from 1 to 5 (exclusive)", () => {
    const result = range(1, 5);
    expect(result).toEqual([1, 2, 3, 4]);
  });

  it("should generate a range from 0 to 3 (exclusive)", () => {
    const result = range(0, 3);
    expect(result).toEqual([0, 1, 2]);
  });

  it("should return an empty array when start equals endExclusive", () => {
    const result = range(5, 5);
    expect(result).toEqual([]);
  });

  it("should generate a range from 1 to 7 (exclusive) — matching CONFIG.zoomLevels", () => {
    const result = range(1, 7);
    expect(result).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

// ------ lon2tilex() tests - -----

describe("lon2tilex()", () => {
  it("should convert 0° longitude to tile x=0 at zoom 0", () => {
    const result = lon2tilex(0, 0);
    expect(result).toBe(0);
  });

  it("should convert 0° longitude to tile x=64 at zoom 7 (half of 128)", () => {
    const result = lon2tilex(0, 7);
    expect(result).toBe(64);
  });

  it("should convert -180° longitude to tile x=0 at any zoom", () => {
    expect(lon2tilex(-180, 1)).toBe(0);
    expect(lon2tilex(-180, 5)).toBe(0);
    expect(lon2tilex(-180, 7)).toBe(0);
  });

  it("should convert 180° longitude to tile x=2^zoom at any zoom", () => {
    expect(lon2tilex(180, 1)).toBe(2);
    expect(lon2tilex(180, 5)).toBe(32);
    expect(lon2tilex(180, 7)).toBe(128);
  });

  it("should convert 90° longitude to tile x=3/4 * 2^zoom", () => {
    expect(lon2tilex(90, 1)).toBe(1);
    expect(lon2tilex(90, 5)).toBe(24);
    expect(lon2tilex(90, 7)).toBe(96);
  });

  it("should convert -90° longitude to tile x=1/4 * 2^zoom", () => {
    expect(lon2tilex(-90, 1)).toBe(0);
    expect(lon2tilex(-90, 5)).toBe(8);
    expect(lon2tilex(-90, 7)).toBe(32);
  });
});

// ------ lat2tiley() tests - -----

describe("lat2tiley()", () => {
  it("should convert 0° latitude to tile y=0 at zoom 0", () => {
    const result = lat2tiley(0, 0);
    expect(result).toBe(0);
  });

  it("should convert 0° latitude to tile y=64 at zoom 7 (half of 128)", () => {
    const result = lat2tiley(0, 7);
    expect(result).toBe(64);
  });

  it("should convert 85.0511° latitude (north pole) to tile y=0 at any zoom", () => {
    const northPole = 85.0511;
    expect(lat2tiley(northPole, 1)).toBe(0);
    expect(lat2tiley(northPole, 5)).toBe(0);
    expect(lat2tiley(northPole, 7)).toBe(0);
  });

  it("should convert -85.0511° latitude (south pole) to tile y=2^zoom - 1 at any zoom", () => {
    const southPole = -85.0511;
    expect(lat2tiley(southPole, 1)).toBe(1);
    expect(lat2tiley(southPole, 5)).toBe(31);
    expect(lat2tiley(southPole, 7)).toBe(127);
  });

  it("should be deterministic — same input always gives same output", () => {
    const result1 = lat2tiley(51.5074, 5); // London
    const result2 = lat2tiley(51.5074, 5);
    expect(result1).toBe(result2);
  });
});

// ------ computeTileBounds() tests - -----

describe("computeTileBounds()", () => {
  it("should compute bounds for the UK region at zoom 1", () => {
    const bounds = computeTileBounds(1, [48.89, -10.77, 59.86, 1.93]);
    expect(bounds.startX).toBeGreaterThanOrEqual(0);
    expect(bounds.endX).toBeGreaterThanOrEqual(bounds.startX);
    expect(bounds.startY).toBeGreaterThanOrEqual(0);
    expect(bounds.endY).toBeGreaterThanOrEqual(bounds.startY);
  });

  it("should compute bounds for London at zoom 5", () => {
    const bounds = computeTileBounds(5, [51.28, -0.51, 51.69, 0.33]);
    expect(bounds.startX).toBeGreaterThanOrEqual(0);
    expect(bounds.endX).toBeGreaterThanOrEqual(bounds.startX);
    expect(bounds.startY).toBeGreaterThanOrEqual(0);
    expect(bounds.endY).toBeGreaterThanOrEqual(bounds.startY);
  });

  it("should produce wider bounds at higher zoom levels", () => {
    const bounds1 = computeTileBounds(1, [48.89, -10.77, 59.86, 1.93]);
    const bounds7 = computeTileBounds(7, [48.89, -10.77, 59.86, 1.93]);
    expect(bounds7.endX - bounds7.startX).toBeGreaterThan(bounds1.endX - bounds1.startX);
    expect(bounds7.endY - bounds7.startY).toBeGreaterThan(bounds1.endY - bounds1.startY);
  });
});

// ------ countTiles() tests - -----

describe("countTiles()", () => {
  it("should count tiles in a 1x1 bounding box", () => {
    const bounds = { startX: 0, endX: 0, startY: 0, endY: 0 };
    expect(countTiles(bounds)).toBe(1);
  });

  it("should count tiles in a 2x2 bounding box", () => {
    const bounds = { startX: 0, endX: 1, startY: 0, endY: 1 };
    expect(countTiles(bounds)).toBe(4);
  });

  it("should count tiles in a 3x2 bounding box", () => {
    const bounds = { startX: 0, endX: 2, startY: 0, endY: 1 };
    expect(countTiles(bounds)).toBe(6);
  });
});

// ------ enumerateTiles() tests - -----

describe("enumerateTiles()", () => {
  it("should enumerate a single tile", () => {
    const bounds = { startX: 0, endX: 0, startY: 0, endY: 0 };
    const tiles = enumerateTiles(5, bounds);
    expect(tiles).toEqual([{ zoom: 5, x: 0, y: 0 }]);
  });

  it("should enumerate a 2x2 grid of tiles", () => {
    const bounds = { startX: 0, endX: 1, startY: 0, endY: 1 };
    const tiles = enumerateTiles(3, bounds);
    expect(tiles.length).toBe(4);
    expect(tiles).toContainEqual({ zoom: 3, x: 0, y: 0 });
    expect(tiles).toContainEqual({ zoom: 3, x: 0, y: 1 });
    expect(tiles).toContainEqual({ zoom: 3, x: 1, y: 0 });
    expect(tiles).toContainEqual({ zoom: 3, x: 1, y: 1 });
  });

  it("should enumerate tiles in row-major order (x varies fastest)", () => {
    const bounds = { startX: 0, endX: 1, startY: 0, endY: 1 };
    const tiles = enumerateTiles(2, bounds);
    expect(tiles[0]).toEqual({ zoom: 2, x: 0, y: 0 });
    expect(tiles[1]).toEqual({ zoom: 2, x: 0, y: 1 });
    expect(tiles[2]).toEqual({ zoom: 2, x: 1, y: 0 });
    expect(tiles[3]).toEqual({ zoom: 2, x: 1, y: 1 });
  });
});

// ------ computeTotalTiles() tests - -----

describe("computeTotalTiles()", () => {
  it("should compute total tiles for a single region at zoom 1", () => {
    const regions = { UK: [48.89, -10.77, 59.86, 1.93] as [number, number, number, number] };
    const total = computeTotalTiles(regions, [1]);
    expect(total).toBeGreaterThan(0);
  });

  it("should compute total tiles for multiple zoom levels", () => {
    const regions = { UK: [48.89, -10.77, 59.86, 1.93] as [number, number, number, number] };
    const total1 = computeTotalTiles(regions, [1]);
    const total2 = computeTotalTiles(regions, [1, 2]);
    expect(total2).toBeGreaterThan(total1);
  });

  it("should compute total tiles for multiple regions", () => {
    const regions = {
      UK: [48.89, -10.77, 59.86, 1.93] as [number, number, number, number],
      London: [51.28, -0.51, 51.69, 0.33] as [number, number, number, number],
    };
    const total = computeTotalTiles(regions, [1]);
    expect(total).toBeGreaterThan(0);
  });

  it("should be deterministic — same input always gives same output", () => {
    const regions = { UK: [48.89, -10.77, 59.86, 1.93] as [number, number, number, number] };
    const result1 = computeTotalTiles(regions, [1, 2, 3]);
    const result2 = computeTotalTiles(regions, [1, 2, 3]);
    expect(result1).toBe(result2);
  });
});
