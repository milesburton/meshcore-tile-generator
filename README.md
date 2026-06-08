# Meshcore Tile Generator

A TypeScript script that pre-fetches map tiles for offline use with the **Meshcore T-Deck Pro** handheld device.

## What It Does

This script downloads map tiles from the [Stadia Maps](https://stadia.com/) tile server (Stamen Toner style) for a specified geographic region across multiple zoom levels (1–7 by default). Tiles are organized following the standard [XYZ tile grid convention](https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames) used by OpenStreetMap and compatible mapping services.

### Key Features

- **Region-based tile generation** — Configurable bounding boxes for any geographic area (currently set to the UK)
- **Multi-zoom support** — Downloads tiles for zoom levels 1 through 7
- **Automatic caching** — Tiles from the global cache directory (`~/Documents/tiles-greater-london`) are copied to the output directory if not already downloaded
- **Resume capability** — Already-downloaded tiles are automatically skipped, allowing the script to be safely re-run
- **Comprehensive logging** — Structured logging with DEBUG, INFO, WARN, and ERROR levels tracks progress, tile status, and failures
- **Pure functional core** — All tile coordinate calculations are pure functions, making them deterministic and testable

## Why This Script

The T-Deck Pro device requires map tiles to be available locally for offline map rendering. Pre-fetching tiles offers several advantages:

1. **Offline map rendering** — No network connectivity required during map navigation on the device
2. **Avoids rate-limiting** — Fetching tiles at runtime can trigger rate limits on tile servers; pre-fetching avoids this
3. **Faster map loading** — Local tiles load instantly without network latency
4. **Selective region coverage** — Only download tiles for areas you actually need, saving storage and bandwidth

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) runtime installed
- SSH key configured for GitHub (if contributing)

### Installation

```bash
cd meshcore-tile-generator
bun install
```

### Usage

```bash
# Run the tile generator
bun run index.ts

# Run in watch mode (auto-restart on file changes)
bun run dev
```

## Configuration

Edit the `CONFIG` object in [`index.ts`](index.ts) to customize:

| Configuration | Description | Default |
|---|---|---|
| `regions` | Geographic bounding boxes `[minLat, minLon, maxLat, maxLon]` | UK: `[48.89, -10.77, 59.86, 1.93]` |
| `zoomLevels` | Array of zoom levels to download | `[1, 2, 3, 4, 5, 6]` |
| `apiKey` | Stadia Maps API key (if required) | `""` |
| `globalDir` | Global tile cache directory | `~/Documents/tiles-greater-london` |
| `outputDir` | Output directory for downloaded tiles | `~/Desktop/tiles` |
| `tileServerUrl` | Function to generate tile URLs | Stadia Maps (Stamen Toner) |

### Adding a New Region

```typescript
const CONFIG = {
  // ...
  regions: {
    UK: [48.89, -10.77, 59.86, 1.93],
    London: [51.28, -0.51, 51.69, 0.33],  // Example: Greater London
  },
  // ...
};
```

## Output Structure

Tiles are saved in the output directory with the following structure:

```
~/Desktop/tiles/
├── 1/                    # Zoom level 1
│   ├── 0/
│   │   └── 0.png
│   └── 1/
│       └── 0.png
├── 2/                    # Zoom level 2
│   ├── 0/
│   │   ├── 0.png
│   │   └── 1.png
│   ├── 1/
│   │   └── ...
│   └── ...
└── ...
```

## Logging

The script uses structured logging with the following levels:

| Level | Output | Description |
|---|---|---|
| `DEBUG` | `console.debug()` | Per-tile download status |
| `INFO` | `console.log()` | Progress updates, summary |
| `WARN` | `console.warn()` | Non-fatal warnings |
| `ERROR` | `console.error()` | Tile download failures |

Progress is logged every 100 tiles and at completion:

```
[2026-06-08T08:38:55.87Z] INFO  Progress: 100/500 | Downloaded: 85 | Cached: 10 | Skipped: 5 | Failed: 0
```

## Project Structure

```
meshcore-tile-generator/
├── index.ts              # Main script (pure functional core + I/O)
├── package.json          # Project metadata and scripts
├── README.md             # This file
└── bun.lock              # Bun lockfile
```

## Development

### Architecture

The script follows a **pure functional core, impure shell** architecture:

- **Pure functions** (no side effects): `range()`, `lon2tilex()`, `lat2tiley()`, `computeTileBounds()`, `countTiles()`, `enumerateTiles()`, `formatLogEntry()`, `createLog()`
- **Impure functions** (I/O): `downloadTile()`, `processTiles()`, `main()`

This separation makes the coordinate calculations testable and the I/O operations isolated and traceable.

### Adding Tests

```bash
bun test
```

## License

MIT
