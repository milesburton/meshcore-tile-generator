// ============================================================================
// Meshcore Tile Generator
// ============================================================================
// This script downloads map tiles for a specified geographic region across
// multiple zoom levels. It is designed to pre-fetch tiles for offline use
// with the Meshcore T-Deck Pro map support.
//
// The tiles are sourced from Stadia Maps (Stamen Toner style) and organized
// by zoom level, x-coordinate, and y-coordinate following the standard
// XYZ tile grid convention used by OpenStreetMap and compatible services.
//
// Why this script:
// - Pre-fetching tiles enables offline map rendering on the T-Deck Pro device
// - Avoids rate-limiting and network issues during runtime map navigation
// - Allows selective region coverage (currently configured for the UK region)
// - Supports resumption: already-downloaded tiles are skipped automatically
// ============================================================================

import { config } from "dotenv";
import { existsSync } from "node:fs";
import { mkdir, copyFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A bounding box represented as [minLat, minLon, maxLat, maxLon].
 * All coordinates are in WGS84 (EPSG:4326) degrees.
 */
export type BoundingBox = [number, number, number, number];

/** Log level constants */
type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

/** Structured log entry */
interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
}

/** Result of downloading a single tile */
interface TileDownloadResult {
  success: boolean;
  alreadyExists: boolean;
  cached: boolean;
  error?: string;
}

/** Accumulator for tile statistics */
interface TileStatsAccumulator {
  downloaded: number;
  cached: number;
  skipped: number;
  failed: number;
}

/** Tile coordinate with zoom level */
export interface TileCoordinate {
  zoom: number;
  x: number;
  y: number;
}

// ---------------------------------------------------------------------------
// Configuration (pure data, no side effects)
// ---------------------------------------------------------------------------

const CONFIG: Readonly<{
  regions: Record<string, BoundingBox>;
  zoomLevels: number[];
  mapstyle: string;
  apiKey: string;
  globalDir: string;
  outputDir: string;
  tileServerUrl: (zoom: number, x: number, y: number) => string;
}> = Object.freeze({
  regions: Object.freeze({
    UK: Object.freeze([48.89, -10.77, 59.86, 1.93] as BoundingBox),
  }),
  zoomLevels: Object.freeze(range(1, 7)),
  mapstyle: "outdoors",
  apiKey: process.env.STADIA_API_KEY ?? "",
  globalDir: join(homedir(), "Documents", "tiles-greater-london"),
  outputDir: join(homedir(), "Desktop", "tiles"),
  tileServerUrl: (zoom: number, x: number, y: number): string =>
    `https://tiles.stadiamaps.com/tiles/stamen_toner/${zoom}/${x}/${y}.png`,
});

// ---------------------------------------------------------------------------
// Pure utility functions
// ---------------------------------------------------------------------------

/**
 * Creates an array of integers from `start` (inclusive) to `endExclusive` (exclusive).
 * Pure function — no side effects.
 */
export function range(start: number, endExclusive: number): number[] {
  return Array.from(
    { length: endExclusive - start },
    (_: unknown, index: number) => start + index,
  );
}

/**
 * Converts longitude to an XYZ tile X coordinate at a given zoom level.
 * Pure function — deterministic, no side effects.
 * @see https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames#Lon..2Flat_to_integers
 */
export function lon2tilex(lon: number, zoom: number): number {
  return Math.floor(((lon + 180.0) / 360.0) * (1 << zoom));
}

/**
 * Converts latitude to an XYZ tile Y coordinate at a given zoom level.
 * Pure function — deterministic, no side effects.
 * @see https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames#Lon..2Flat_to_integers
 */
export function lat2tiley(lat: number, zoom: number): number {
  return Math.floor(
    (
      1.0 -
      Math.log(
        Math.tan((lat * Math.PI) / 180.0) +
          1.0 / Math.cos((lat * Math.PI) / 180.0),
      ) / Math.PI,
    ) / 2.0 * (1 << zoom),
  );
}

/**
 * Computes the tile bounding box for a given zoom level and geographic region.
 * Returns `{ startX, endX, startY, endY }`.
 * Pure function — no side effects.
 */
export function computeTileBounds(
  zoom: number,
  [minLat, minLon, maxLat, maxLon]: BoundingBox,
): { startX: number; endX: number; startY: number; endY: number } {
  return {
    startX: lon2tilex(minLon, zoom),
    endX: lon2tilex(maxLon, zoom),
    startY: lat2tiley(maxLat, zoom),
    endY: lat2tiley(minLat, zoom),
  };
}

/**
 * Counts the total number of tiles in a tile bounding box.
 * Pure function — no side effects.
 */
export function countTiles(bounds: { startX: number; endX: number; startY: number; endY: number }): number {
  return (bounds.endX - bounds.startX + 1) * (bounds.endY - bounds.startY + 1);
}

/**
 * Generates all tile coordinates within a bounding box for a given zoom level.
 * Pure function — no side effects.
 */
export function enumerateTiles(
  zoom: number,
  bounds: { startX: number; endX: number; startY: number; endY: number },
): TileCoordinate[] {
  return range(bounds.startX, bounds.endX + 1).flatMap((x: number) =>
    range(bounds.startY, bounds.endY + 1).map((y: number) => ({ zoom, x, y })),
  );
}

/**
 * Computes the total number of tiles across all regions and zoom levels.
 * Pure function — uses reduce for accumulation.
 */
export function computeTotalTiles(
  regions: Record<string, BoundingBox>,
  zoomLevels: number[],
): number {
  const regionTileCounts = Object.values(regions).map((bounds: BoundingBox) =>
    zoomLevels.map((zoom: number) => {
      const tileBounds = computeTileBounds(zoom, bounds);
      return countTiles(tileBounds);
    }),
  );

  return regionTileCounts.flat().reduce((sum: number, count: number) => sum + count, 0);
}

// ---------------------------------------------------------------------------
// Logging (pure formatting, I/O handled by caller)
// ---------------------------------------------------------------------------

/** Formats a log entry as a string with timestamp and level prefix. */
function formatLogEntry(entry: LogEntry): string {
  const pad = (str: string, len: number): string => str.padEnd(len, " ");
  return `[${entry.timestamp}] ${pad(entry.level, 5)} ${entry.message}`;
}

/** Creates a timestamp string in ISO-8601 format. */
function timestamp(): string {
  return new Date().toISOString();
}

/** Creates a log entry. Pure function. */
function createLog(level: LogLevel, message: string): LogEntry {
  return { level, message, timestamp: timestamp() };
}

/** Logs a message to stdout/stderr based on level. */
function log(entry: LogEntry): void {
  const formatted = formatLogEntry(entry);
  switch (entry.level) {
    case "DEBUG":
      console.debug(formatted);
      break;
    case "INFO":
      console.log(formatted);
      break;
    case "WARN":
      console.warn(formatted);
      break;
    case "ERROR":
      console.error(formatted);
      break;
  }
}

// ---------------------------------------------------------------------------
// Tile I/O operations (impure, but isolated)
// ---------------------------------------------------------------------------

/**
 * Constructs the file path for a tile at a given zoom level.
 * Pure function.
 */
function tilePath(outputDir: string, zoom: number, x: number, y: number): string {
  return join(outputDir, String(zoom), String(x), `${y}.png`);
}

/**
 * Constructs the global cache path for a tile.
 * Pure function.
 */
function globalTilePath(globalDir: string, zoom: number, x: number, y: number): string {
  return join(globalDir, String(zoom), String(x), `${y}.png`);
}

/**
 * Checks whether a tile already exists at the given path.
 * Impure (filesystem I/O).
 */
function tileExists(path: string): boolean {
  return existsSync(path);
}

/**
 * Downloads a single tile from the tile server.
 * Returns result object indicating tile status.
 * Impure (network I/O, filesystem I/O).
 */
async function downloadTile(
  outputDir: string,
  globalDir: string,
  zoom: number,
  x: number,
  y: number,
  tileServerUrl: (zoom: number, x: number, y: number) => string,
  apiKey: string,
): Promise<TileDownloadResult> {
  const path = tilePath(outputDir, zoom, x, y);

  // Check if tile already exists in output directory
  if (tileExists(path)) {
    return { success: true, alreadyExists: true, cached: false };
  }

  // Check if tile exists in global cache directory
  const cachePath = globalTilePath(globalDir, zoom, x, y);
  if (tileExists(cachePath)) {
    await mkdir(join(outputDir, String(zoom)), { recursive: true });
    await copyFile(cachePath, path);
    return { success: true, alreadyExists: false, cached: true };
  }

  // Download from tile server
  const url = tileServerUrl(zoom, x, y);
  const headers: Record<string, string> = {
    Connection: "close",
    Authorization: `Stadia-Auth ${apiKey}`,
  };

  try {
    const response = await fetch(url, { headers });

    if (response.ok) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      await mkdir(join(outputDir, String(zoom)), { recursive: true });
      await writeFile(path, bytes);
      return { success: true, alreadyExists: false, cached: false };
    } else {
      return {
        success: false,
        alreadyExists: false,
        cached: false,
        error: `HTTP ${response.status} ${response.statusText}`,
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      alreadyExists: false,
      cached: false,
      error: `Network error: ${errorMessage}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Main orchestration (pure computation + impure I/O separation)
// ---------------------------------------------------------------------------

/**
 * Processes all tiles for the given configuration.
 * Uses functional patterns (map/reduce) for pure computation,
 * and sequential async processing for I/O operations.
 */
async function processTiles(config: typeof CONFIG): Promise<TileStatsAccumulator> {
  const stats: TileStatsAccumulator = {
    downloaded: 0,
    cached: 0,
    skipped: 0,
    failed: 0,
  };

  // Compute total tiles (pure)
  const totalTiles = computeTotalTiles(config.regions, config.zoomLevels);

  // Ensure output directory exists (impure, done once)
  await mkdir(config.outputDir, { recursive: true });

  log(createLog("INFO", `Starting tile generation for ${Object.keys(config.regions).length} region(s)`));
  log(createLog("INFO", `Zoom levels: ${config.zoomLevels.join(", ")}`));
  log(createLog("INFO", `Total tiles to process: ${totalTiles}`));
  log(createLog("INFO", `Output directory: ${config.outputDir}`));
  log(createLog("INFO", `Global cache directory: ${config.globalDir}`));
  log(createLog("INFO", "─".repeat(80)));

  let completedTiles = 0;

  // Generate all tile coordinates using functional patterns (pure)
  const allTiles: TileCoordinate[] = Object.entries(config.regions).flatMap(
    ([_regionName, bounds]) =>
      config.zoomLevels.flatMap((zoom) => {
        const tileBounds = computeTileBounds(zoom, bounds);
        return enumerateTiles(zoom, tileBounds);
      }),
  );

  // Process each tile sequentially (impure I/O)
  for (const tile of allTiles) {
    const result = await downloadTile(
      config.outputDir,
      config.globalDir,
      tile.zoom,
      tile.x,
      tile.y,
      config.tileServerUrl,
      config.apiKey,
    );

    completedTiles++;

    // Update stats using functional update pattern
    const newStats = result.alreadyExists
      ? { ...stats, skipped: stats.skipped + 1 }
      : result.cached
        ? { ...stats, cached: stats.cached + 1 }
        : result.success
          ? { ...stats, downloaded: stats.downloaded + 1 }
          : { ...stats, failed: stats.failed + 1 };

    // Log per-tile status
    const logLevel = result.success ? "DEBUG" : "ERROR";
    const logMessage = result.alreadyExists
      ? `Tile ${tile.zoom}/${tile.x}/${tile.y} — already exists (skipped)`
      : result.cached
        ? `Tile ${tile.zoom}/${tile.x}/${tile.y} — copied from cache`
        : result.success
          ? `Tile ${tile.zoom}/${tile.x}/${tile.y} — downloaded`
          : `Tile ${tile.zoom}/${tile.x}/${tile.y} — failed: ${result.error}`;

    log(createLog(logLevel as LogLevel, logMessage));

    // Log progress every 100 tiles or at the end
    if (completedTiles % 100 === 0 || completedTiles === totalTiles) {
      log(
        createLog(
          "INFO",
          `Progress: ${completedTiles}/${totalTiles} | ` +
          `Downloaded: ${newStats.downloaded} | ` +
          `Cached: ${newStats.cached} | ` +
          `Skipped: ${newStats.skipped} | ` +
          `Failed: ${newStats.failed}`,
        ),
      );
    }

    // Update stats reference
    Object.assign(stats, newStats);
  }

  log(createLog("INFO", "─".repeat(80)));
  log(createLog("INFO", "Tile generation complete!"));
  log(createLog("INFO", `  Downloaded: ${stats.downloaded}`));
  log(createLog("INFO", `  Cached:     ${stats.cached}`));
  log(createLog("INFO", `  Skipped:    ${stats.skipped}`));
  log(createLog("INFO", `  Failed:     ${stats.failed}`));
  log(createLog("INFO", `  Total:      ${totalTiles}`));

  return stats;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // Load .env file
  config();

  log(createLog("INFO", "Meshcore Tile Generator started"));
  log(createLog("INFO", "─".repeat(80)));

  // Validate API key is configured
  if (!process.env.STADIA_API_KEY) {
    log(createLog("ERROR", "STADIA_API_KEY environment variable is not set."));
    log(createLog("ERROR", "Create a .env file with: STADIA_API_KEY=your-api-key-here"));
    log(createLog("ERROR", "Get your key at: https://stadia.mapswithme.com/"));
    process.exit(1);
  }

  const stats = await processTiles(CONFIG);

  // Exit with error code if any tiles failed
  if (stats.failed > 0) {
    log(createLog("WARN", `${stats.failed} tile(s) failed to download. Check logs for details.`));
  }

  log(createLog("INFO", "Meshcore Tile Generator finished"));
}

// Only run main() when executed directly (not when imported by tests)
if (import.meta.main) {
  await main();
}
