const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const root = path.resolve(__dirname, "..");
const distDir = path.join(root, "dist", "logos", "v20260620r2");
const tilesDir = path.join(root, "generated", "logo-test", "tiles");
const targets = process.argv.includes("--all") ? [tilesDir, distDir] : [distDir];
const idsArgIndex = process.argv.indexOf("--ids");
const targetIds = idsArgIndex >= 0
  ? new Set(String(process.argv[idsArgIndex + 1] || "").split(",").map((id) => id.trim()).filter(Boolean))
  : null;
const fixBackground = process.argv.includes("--fix-background") || Boolean(targetIds);

const edgeWidth = 8;
const lineBand = 24;
const minLineRun = 120;
const minIsolatedLineRun = 80;

function listImages(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((file) => /\.(png|webp)$/i.test(file))
    .filter((file) => !targetIds || targetIds.has(path.basename(file, path.extname(file))))
    .map((file) => path.join(dir, file));
}

function isLightNeutral(r, g, b, a, strictEdge) {
  if (a !== undefined && a < 12) return false;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const avg = (r + g + b) / 3;
  return avg >= (strictEdge ? 112 : 168) && max - min <= 24;
}

function isOnOuterBand(x, y, width, height) {
  return x < edgeWidth || y < edgeWidth || x >= width - edgeWidth || y >= height - edgeWidth;
}

function isOnStrictEdge(x, y, width, height) {
  return x < 4 || y < 4 || x >= width - 4 || y >= height - 4;
}

function isDarkOrGrayLinePixel(r, g, b, a) {
  if (a !== undefined && a < 12) return false;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const avg = (r + g + b) / 3;
  return avg >= 0 && avg <= 252 && max - min <= 34;
}

function isWhiteLike(r, g, b, a) {
  if (a !== undefined && a < 12) return true;
  return r >= 242 && g >= 242 && b >= 242;
}

function isNearWhiteBackground(r, g, b, a) {
  if (a !== undefined && a < 12) return true;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const avg = (r + g + b) / 3;
  return avg >= 236 && max - min <= 22;
}

function whitenEdgeConnectedBackground(data, info) {
  const total = info.width * info.height;
  const seen = new Uint8Array(total);
  const queue = [];

  const enqueue = (x, y) => {
    if (x < 0 || y < 0 || x >= info.width || y >= info.height) return;
    const index = y * info.width + x;
    if (seen[index]) return;
    const offset = index * info.channels;
    if (!isNearWhiteBackground(data[offset], data[offset + 1], data[offset + 2], data[offset + 3])) return;
    seen[index] = 1;
    queue.push(index);
  };

  for (let x = 0; x < info.width; x += 1) {
    enqueue(x, 0);
    enqueue(x, info.height - 1);
  }
  for (let y = 1; y < info.height - 1; y += 1) {
    enqueue(0, y);
    enqueue(info.width - 1, y);
  }

  let changed = 0;
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const index = queue[cursor];
    const offset = index * info.channels;
    if (data[offset] !== 255 || data[offset + 1] !== 255 || data[offset + 2] !== 255 || data[offset + 3] !== 255) {
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = 255;
      changed += 1;
    }
    const x = index % info.width;
    const y = Math.floor(index / info.width);
    enqueue(x + 1, y);
    enqueue(x - 1, y);
    enqueue(x, y + 1);
    enqueue(x, y - 1);
  }

  return changed;
}

function markRun(mask, width, startX, endX, y) {
  for (let x = startX; x < endX; x += 1) mask[y * width + x] = 1;
}

function markColumnRun(mask, width, x, startY, endY) {
  for (let y = startY; y < endY; y += 1) mask[y * width + x] = 1;
}

function markStraightBorderLines(data, info) {
  const mask = new Uint8Array(info.width * info.height);

  const scanRow = (y) => {
    let runStart = -1;
    for (let x = 0; x <= info.width; x += 1) {
      const ok = x < info.width && (() => {
        const offset = (y * info.width + x) * info.channels;
        return isDarkOrGrayLinePixel(data[offset], data[offset + 1], data[offset + 2], data[offset + 3]);
      })();
      if (ok && runStart < 0) runStart = x;
      if ((!ok || x === info.width) && runStart >= 0) {
        if (x - runStart >= minLineRun) markRun(mask, info.width, runStart, x, y);
        runStart = -1;
      }
    }
  };

  const scanColumn = (x) => {
    let runStart = -1;
    for (let y = 0; y <= info.height; y += 1) {
      const ok = y < info.height && (() => {
        const offset = (y * info.width + x) * info.channels;
        return isDarkOrGrayLinePixel(data[offset], data[offset + 1], data[offset + 2], data[offset + 3]);
      })();
      if (ok && runStart < 0) runStart = y;
      if ((!ok || y === info.height) && runStart >= 0) {
        if (y - runStart >= minLineRun) markColumnRun(mask, info.width, x, runStart, y);
        runStart = -1;
      }
    }
  };

  const isolatedVertical = (x, y) => {
    const left = Math.max(0, x - 3);
    const right = Math.min(info.width - 1, x + 3);
    const lo = (y * info.width + left) * info.channels;
    const ro = (y * info.width + right) * info.channels;
    return isWhiteLike(data[lo], data[lo + 1], data[lo + 2], data[lo + 3]) &&
      isWhiteLike(data[ro], data[ro + 1], data[ro + 2], data[ro + 3]);
  };

  const isolatedHorizontal = (x, y) => {
    const top = Math.max(0, y - 3);
    const bottom = Math.min(info.height - 1, y + 3);
    const to = (top * info.width + x) * info.channels;
    const bo = (bottom * info.width + x) * info.channels;
    return isWhiteLike(data[to], data[to + 1], data[to + 2], data[to + 3]) &&
      isWhiteLike(data[bo], data[bo + 1], data[bo + 2], data[bo + 3]);
  };

  const scanIsolatedColumn = (x) => {
    let runStart = -1;
    let isolatedCount = 0;
    for (let y = 0; y <= info.height; y += 1) {
      const ok = y < info.height && (() => {
        const offset = (y * info.width + x) * info.channels;
        return isDarkOrGrayLinePixel(data[offset], data[offset + 1], data[offset + 2], data[offset + 3]);
      })();
      if (ok && runStart < 0) {
        runStart = y;
        isolatedCount = 0;
      }
      if (ok && isolatedVertical(x, y)) isolatedCount += 1;
      if ((!ok || y === info.height) && runStart >= 0) {
        const runLength = y - runStart;
        let leftDark = 0;
        let rightDark = 0;
        const leftX = Math.max(0, x - 1);
        const rightX = Math.min(info.width - 1, x + 1);
        for (let yy = runStart; yy < y; yy += 1) {
          const lo = (yy * info.width + leftX) * info.channels;
          const ro = (yy * info.width + rightX) * info.channels;
          if (isDarkOrGrayLinePixel(data[lo], data[lo + 1], data[lo + 2], data[lo + 3])) leftDark += 1;
          if (isDarkOrGrayLinePixel(data[ro], data[ro + 1], data[ro + 2], data[ro + 3])) rightDark += 1;
        }
        const thinLine = Math.max(leftDark, rightDark) / runLength <= 0.35;
        if (runLength >= minIsolatedLineRun && (isolatedCount / runLength >= 0.82 || thinLine)) {
          markColumnRun(mask, info.width, x, runStart, y);
        }
        runStart = -1;
      }
    }
  };

  const scanIsolatedRow = (y) => {
    let runStart = -1;
    let isolatedCount = 0;
    for (let x = 0; x <= info.width; x += 1) {
      const ok = x < info.width && (() => {
        const offset = (y * info.width + x) * info.channels;
        return isDarkOrGrayLinePixel(data[offset], data[offset + 1], data[offset + 2], data[offset + 3]);
      })();
      if (ok && runStart < 0) {
        runStart = x;
        isolatedCount = 0;
      }
      if (ok && isolatedHorizontal(x, y)) isolatedCount += 1;
      if ((!ok || x === info.width) && runStart >= 0) {
        const runLength = x - runStart;
        let topDark = 0;
        let bottomDark = 0;
        const topY = Math.max(0, y - 1);
        const bottomY = Math.min(info.height - 1, y + 1);
        for (let xx = runStart; xx < x; xx += 1) {
          const to = (topY * info.width + xx) * info.channels;
          const bo = (bottomY * info.width + xx) * info.channels;
          if (isDarkOrGrayLinePixel(data[to], data[to + 1], data[to + 2], data[to + 3])) topDark += 1;
          if (isDarkOrGrayLinePixel(data[bo], data[bo + 1], data[bo + 2], data[bo + 3])) bottomDark += 1;
        }
        const thinLine = Math.max(topDark, bottomDark) / runLength <= 0.35;
        if (runLength >= minIsolatedLineRun && (isolatedCount / runLength >= 0.82 || thinLine)) {
          markRun(mask, info.width, runStart, x, y);
        }
        runStart = -1;
      }
    }
  };

  const darkAt = (x, y) => {
    if (x < 0 || y < 0 || x >= info.width || y >= info.height) return false;
    const offset = (y * info.width + x) * info.channels;
    return isDarkOrGrayLinePixel(data[offset], data[offset + 1], data[offset + 2], data[offset + 3]);
  };

  const darkCountInColumnRun = (x, startY, endY) => {
    if (x < 0 || x >= info.width) return 0;
    let count = 0;
    for (let y = startY; y < endY; y += 1) if (darkAt(x, y)) count += 1;
    return count;
  };

  const darkCountInRowRun = (y, startX, endX) => {
    if (y < 0 || y >= info.height) return 0;
    let count = 0;
    for (let x = startX; x < endX; x += 1) if (darkAt(x, y)) count += 1;
    return count;
  };

  const scanThinVerticalClusters = () => {
    for (let x = 0; x < info.width; x += 1) {
      let runStart = -1;
      for (let y = 0; y <= info.height; y += 1) {
        const ok = y < info.height && darkAt(x, y);
        if (ok && runStart < 0) runStart = y;
        if ((!ok || y === info.height) && runStart >= 0) {
          const runLength = y - runStart;
          if (runLength >= minIsolatedLineRun) {
            let left = x;
            let right = x;
            while (left > 0 && darkCountInColumnRun(left - 1, runStart, y) / runLength >= 0.55) left -= 1;
            while (right < info.width - 1 && darkCountInColumnRun(right + 1, runStart, y) / runLength >= 0.55) right += 1;
            const width = right - left + 1;
            const outsideLeft = darkCountInColumnRun(left - 1, runStart, y) / runLength;
            const outsideRight = darkCountInColumnRun(right + 1, runStart, y) / runLength;
            if (width <= 4 && Math.max(outsideLeft, outsideRight) <= 0.25) {
              for (let xx = left; xx <= right; xx += 1) markColumnRun(mask, info.width, xx, runStart, y);
            }
          }
          runStart = -1;
        }
      }
    }
  };

  const scanThinHorizontalClusters = () => {
    for (let y = 0; y < info.height; y += 1) {
      let runStart = -1;
      for (let x = 0; x <= info.width; x += 1) {
        const ok = x < info.width && darkAt(x, y);
        if (ok && runStart < 0) runStart = x;
        if ((!ok || x === info.width) && runStart >= 0) {
          const runLength = x - runStart;
          if (runLength >= minIsolatedLineRun) {
            let top = y;
            let bottom = y;
            while (top > 0 && darkCountInRowRun(top - 1, runStart, x) / runLength >= 0.55) top -= 1;
            while (bottom < info.height - 1 && darkCountInRowRun(bottom + 1, runStart, x) / runLength >= 0.55) bottom += 1;
            const height = bottom - top + 1;
            const outsideTop = darkCountInRowRun(top - 1, runStart, x) / runLength;
            const outsideBottom = darkCountInRowRun(bottom + 1, runStart, x) / runLength;
            if (height <= 4 && Math.max(outsideTop, outsideBottom) <= 0.25) {
              for (let yy = top; yy <= bottom; yy += 1) markRun(mask, info.width, runStart, x, yy);
            }
          }
          runStart = -1;
        }
      }
    }
  };

  for (let y = 0; y < lineBand; y += 1) scanRow(y);
  for (let y = info.height - lineBand; y < info.height; y += 1) scanRow(y);
  for (let x = 0; x < lineBand; x += 1) scanColumn(x);
  for (let x = info.width - lineBand; x < info.width; x += 1) scanColumn(x);
  for (let x = 0; x < info.width; x += 1) scanIsolatedColumn(x);
  for (let y = 0; y < info.height; y += 1) scanIsolatedRow(y);
  scanThinVerticalClusters();
  scanThinHorizontalClusters();

  let marked = 0;
  for (let i = 0; i < mask.length; i += 1) {
    if (!mask[i]) continue;
    const offset = i * info.channels;
    data[offset] = 255;
    data[offset + 1] = 255;
    data[offset + 2] = 255;
    data[offset + 3] = 255;
    marked += 1;
  }
  return marked;
}

async function cleanImage(file) {
  const resolvedFile = path.resolve(file);
  const isAllowed = targets.some((dir) => resolvedFile.startsWith(`${path.resolve(dir)}${path.sep}`));
  if (!isAllowed) throw new Error(`Refusing to modify file outside logo directories: ${file}`);

  const sourceBuffer = fs.readFileSync(file);
  const image = sharp(sourceBuffer, { animated: false }).ensureAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  let changed = 0;
  changed += markStraightBorderLines(data, info);
  if (fixBackground) changed += whitenEdgeConnectedBackground(data, info);

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (!isOnOuterBand(x, y, info.width, info.height)) continue;
      const offset = (y * info.width + x) * info.channels;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      const a = data[offset + 3];
      if (!isLightNeutral(r, g, b, a, isOnStrictEdge(x, y, info.width, info.height))) continue;
      if (r === 255 && g === 255 && b === 255 && a === 255) continue;
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = 255;
      changed += 1;
    }
  }

  if (!changed) return { file, changed };

  const output = sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: info.channels
    }
  });

  if (/\.webp$/i.test(file)) {
    await output.webp({ quality: 86 }).toFile(`${file}.tmp`);
  } else {
    await output.png().toFile(`${file}.tmp`);
  }
  fs.rmSync(file, { force: true });
  fs.renameSync(`${file}.tmp`, file);
  return { file, changed };
}

async function main() {
  const files = targets.flatMap(listImages);
  let changedFiles = 0;
  let changedPixels = 0;
  const samples = [];

  for (const file of files) {
    const result = await cleanImage(file);
    if (!result.changed) continue;
    changedFiles += 1;
    changedPixels += result.changed;
    if (samples.length < 12) samples.push(path.relative(root, file));
  }

  console.log(JSON.stringify({
    scanned: files.length,
    changedFiles,
    changedPixels,
    samples
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
