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
type BoundingBox = [number, number, number, number];

/** Log level constants */
type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

/** Structured log entry */
interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
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
  apiKey: "",
  globalDir: join(homedir(), "Documents", "tiles-greater-london"),
  outputDir: join(homedir(), "Desktop", "tiles"),
  tileServerUrl: (zoom: number, x: number, y: number): string =>
    `https://tiles.stadiamaps.com/tiles/stamen_toner/${zoom}/${x}/${y}.png`,
});

// ---------------------------------------------------------------------------
// Pure utility functions
// ---------------------------------------------------------------------------

/**
 * Creates an inclusive range of integers from `start` to `endExclusive - 1`.
 * Pure function — no side effects.
 */
function range(start: number, endExclusive: number): number[] {
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
function lon2tilex(lon: number, zoom: number): number {
  return Math.floor(((lon + 180.0) / 360.0) * (1 << zoom));
}

/**
 * Converts latitude to an XYZ tile Y coordinate at a given zoom level.
 * Pure function — deterministic, no side effects.
 * @see https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames#Lon..2Flat_to_integers
 */
function lat2tiley(lat: number, zoom: number): number {
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
function computeTileBounds(
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
function countTiles(bounds: { startX: number; endX: number; startY: number; endY: number }): number {
  return (bounds.endX - bounds.startX + 1) * (bounds.endY - bounds.startY + 1);
}

/**
 * Generates all tile coordinates within a bounding box as an array of tuples.
 * Pure function — no side effects.
 */
function enumerateTiles(bounds: {
  startX: number;
  endX: number;
  startY: number;
  endY: number;
}): Array<{ zoom: number; x: number; y: number }> {
  const tiles: Array<{ zoom: number; x: number; y: number }> = [];
  for (let x = bounds.startX; x <= bounds.endX; x++) {
    for (let y = bounds.startY; y <= bounds.endY; y++) {
      tiles.push({ zoom: 0, x, y }); // zoom will be set by the caller
    }
  }
  return tiles;
}

// ---------------------------------------------------------------------------
// Logging (pure formatting, I/O handled by caller)
// ---------------------------------------------------------------------------

/** Formats a log entry as a string with timestamp and level prefix. */
function formatLogEntry(entry: LogEntry): string {
  const pad = (str: string, len: number): string =>
    str.padEnd(len, " ");
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
 * Returns `true` if the tile was successfully downloaded, `false` otherwise.
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
): Promise<{ success: boolean; alreadyExists: boolean; cached: boolean; error?: string }> {
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

interface TileStats {
  totalTiles: number;
  downloaded: number;
  cached: number;
  skipped: number;
  failed: number;
}

/**
 * Computes the total number of tiles across all regions and zoom levels.
 * Pure function.
 */
function computeTotalTiles(
  regions: Record<string, BoundingBox>,
  zoomLevels: number[],
): number {
  let total = 0;
  for (const zoom of zoomLevels) {
    for (const bounds of Object.values(regions)) {
      const tileBounds = computeTileBounds(zoom, bounds);
      total += countTiles(tileBounds);
    }
  }
  return total;
}

/**
 * Processes all tiles for the given configuration.
 * Handles both pure computation and impure I/O in a structured way.
 */
async function processTiles(
  config: typeof CONFIG,
): Promise<TileStats> {
  const stats: TileStats = {
    totalTiles: 0,
    downloaded: 0,
    cached: 0,
    skipped: 0,
    failed: 0,
  };

  // Compute total tiles (pure)
  stats.totalTiles = computeTotalTiles(config.regions, config.zoomLevels);

  // Ensure output directory exists (impure, done once)
  await mkdir(config.outputDir, { recursive: true });

  log(createLog("INFO", `Starting tile generation for ${Object.keys(config.regions).length} region(s)`));
  log(createLog("INFO", `Zoom levels: ${config.zoomLevels.join(", ")}`));
  log(createLog("INFO", `Total tiles to process: ${stats.totalTiles}`));
  log(createLog("INFO", `Output directory: ${config.outputDir}`));
  log(createLog("INFO", `Global cache directory: ${config.globalDir}`));
  log(createLog("INFO", "─".repeat(80)));

  let completedTiles = 0;

  // Process each zoom level and region (impure I/O in nested loops)
  for (const zoom of config.zoomLevels) {
    for (const [regionName, bounds] of Object.entries(config.regions)) {
      const tileBounds = computeTileBounds(zoom, bounds);
      const regionTileCount = countTiles(tileBounds);

      log(createLog("INFO", `Region: ${regionName} | Zoom: ${zoom} | Tiles: ${regionTileCount}`));

      for (let x = tileBounds.startX; x <= tileBounds.endX; x++) {
        for (let y = tileBounds.startY; y <= tileBounds.endY; y++) {
          const result = await downloadTile(
            config.outputDir,
            config.globalDir,
            zoom,
            x,
            y,
            config.tileServerUrl,
            config.apiKey,
          );

          completedTiles++;

          if (result.alreadyExists) {
            stats.skipped++;
            log(createLog("DEBUG", `Tile ${zoom}/${x}/${y} — already exists (skipped)`));
          } else if (result.cached) {
            stats.cached++;
            log(createLog("DEBUG", `Tile ${zoom}/${x}/${y} — copied from cache`));
          } else if (result.success) {
            stats.downloaded++;
            log(createLog("DEBUG", `Tile ${zoom}/${x}/${y} — downloaded`));
          } else {
            stats.failed++;
            log(createLog("ERROR", `Tile ${zoom}/${x}/${y} — failed: ${result.error}`));
          }

          // Log progress every 100 tiles or at the end
          if (completedTiles % 100 === 0 || completedTiles === stats.totalTiles) {
            log(
              createLog(
                "INFO",
                `Progress: ${completedTiles}/${stats.totalTiles} | ` +
                `Downloaded: ${stats.downloaded} | ` +
                `Cached: ${stats.cached} | ` +
                `Skipped: ${stats.skipped} | ` +
                `Failed: ${stats.failed}`,
              ),
            );
          }
        }
      }
    }
  }

  log(createLog("INFO", "─".repeat(80)));
  log(createLog("INFO", "Tile generation complete!"));
  log(createLog("INFO", `  Downloaded: ${stats.downloaded}`));
  log(createLog("INFO", `  Cached:     ${stats.cached}`));
  log(createLog("INFO", `  Skipped:    ${stats.skipped}`));
  log(createLog("INFO", `  Failed:     ${stats.failed}`));
  log(createLog("INFO", `  Total:      ${stats.totalTiles}`));

  return stats;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  log(createLog("INFO", "Meshcore Tile Generator started"));
  log(createLog("INFO", "─".repeat(80)));

  const stats = await processTiles(CONFIG);

  // Exit with error code if any tiles failed
  if (stats.failed > 0) {
    log(createLog("WARN", `${stats.failed} tile(s) failed to download. Check logs for details.`));
  }

  log(createLog("INFO", "Meshcore Tile Generator finished"));
}

await main();
