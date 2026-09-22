// Small, dependency-free Code 128 decoder used only when the browser does not
// expose BarcodeDetector. The native detector remains the primary/fast path.

const PATTERNS = [
  "212222","222122","222221","121223","121322","131222","122213","122312","132212","221213","221312","231212",
  "112232","122132","122231","113222","123122","123221","223211","221132","221231","213212","223112","312131",
  "311222","321122","321221","312212","322112","322211","212123","212321","232121","111323","131123","131321",
  "112313","132113","132311","211313","231113","231311","112133","112331","132131","113123","113321","133121",
  "313121","211331","231131","213113","213311","213131","311123","311321","331121","312113","312311","332111",
  "314111","221411","431111","111224","111422","121124","121421","141122","141221","112214","112412","122114",
  "122411","142112","142211","241211","221114","413111","241112","134111","111242","121142","121241","114212",
  "124112","124211","411212","421112","421211","212141","214121","412121","111143","111341","131141","114113",
  "114311","411113","411311","113141","114131","311141","411131","211412","211214","211232",
];

const STOP = "2331112";
const START_VALUES = new Set([103, 104, 105]);

function patternError(runs, pattern) {
  if (runs.length !== pattern.length) return Infinity;
  const total = runs.reduce((a, b) => a + b, 0);
  const units = pattern.split("").map(Number);
  const unitTotal = units.reduce((a, b) => a + b, 0);
  const scale = total / unitTotal;
  let error = 0;

  for (let i = 0; i < units.length; i += 1) {
    error += Math.abs(runs[i] - units[i] * scale) / Math.max(scale, 1) * 0.1;
  }
  return error;
}

function nearestSymbol(runs) {
  if (runs.length !== 6) return null;
  const total = runs.reduce((a, b) => a + b, 0);
  if (!total) return null;

  let bestValue = -1;
  let bestError = Infinity;

  for (let value = 0; value < PATTERNS.length; value += 1) {
    const pattern = PATTERNS[value];
    const units = pattern.split("").map(Number);
    const unitTotal = units.reduce((a, b) => a + b, 0);
    const scale = total / unitTotal;

    let error = 0;
    for (let i = 0; i < 6; i += 1) {
      error += Math.abs(runs[i] / total - units[i] / unitTotal);
      error += Math.abs(runs[i] - units[i] * scale) / Math.max(scale, 1) * 0.08;
    }

    if (error < bestError) {
      bestError = error;
      bestValue = value;
    }
  }

  return { value: bestValue, error: bestError };
}

function decodeValues(values) {
  const start = values[0];
  let set = start === 103 ? "A" : start === 104 ? "B" : start === 105 ? "C" : null;
  if (!set) return null;

  let output = "";

  for (let i = 1; i < values.length; i += 1) {
    const value = values[i];

    if (set === "B") {
      if (value === 99) { set = "C"; continue; }
      if (value === 101) { set = "A"; continue; }
      if (value === 98) continue; // SHIFT is not needed for student IDs.
      if (value >= 0 && value <= 95) output += String.fromCharCode(value + 32);
    } else if (set === "A") {
      if (value === 100) { set = "B"; continue; }
      if (value === 99) { set = "C"; continue; }
      if (value === 98) continue;
      if (value >= 0 && value <= 95) {
        output += String.fromCharCode(value < 64 ? value + 32 : value - 64);
      }
    } else {
      if (value === 100) { set = "B"; continue; }
      if (value === 101) { set = "A"; continue; }
      if (value >= 0 && value <= 99) output += String(value).padStart(2, "0");
    }
  }

  return output || null;
}

function decodeRuns(runs) {
  if (runs.length < 13) return null;

  for (let start = 0; start <= runs.length - 13; start += 1) {
    const first = nearestSymbol(runs.slice(start, start + 6));
    if (!first || first.error > 0.55 || !START_VALUES.has(first.value)) continue;

    const values = [first.value];
    let position = start + 6;

    for (let guard = 0; guard < 120 && position + 6 <= runs.length; guard += 1) {
      const symbol = nearestSymbol(runs.slice(position, position + 6));
      if (!symbol || symbol.error > 0.55) break;

      values.push(symbol.value);
      position += 6;

      // Stop is the final 7-module pattern. Validate it before accepting the
      // checksum, which makes false positives from text/glare much less likely.
      if (values.length >= 3 && position + 7 <= runs.length) {
        const stopError = patternError(runs.slice(position, position + 7), STOP);
        if (stopError < 0.75) {
          const checksum = values[values.length - 1];
          const data = values.slice(0, -1);
          let sum = data[0];
          for (let i = 1; i < data.length; i += 1) sum += data[i] * i;

          if (sum % 103 === checksum) return decodeValues(data);
        }
      }
    }
  }

  return null;
}

function rowToRuns(gray, width, y, threshold) {
  const runs = [];
  const startsBlack = gray[y * width] < threshold;
  let black = startsBlack;
  let count = 1;

  for (let x = 1; x < width; x += 1) {
    const nextBlack = gray[y * width + x] < threshold;
    if (nextBlack === black) {
      count += 1;
    } else {
      runs.push(count);
      count = 1;
      black = nextBlack;
    }
  }
  runs.push(count);

  // A Code 128 symbol starts with a black bar. Remove the white quiet zone.
  if (!startsBlack && runs.length) runs.shift();
  return runs;
}

function decodeRow(gray, width, y) {
  let min = 255;
  let max = 0;
  for (let x = 0; x < width; x += 1) {
    const value = gray[y * width + x];
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (max - min < 35) return null;

  // Try the natural midpoint first, then slightly darker/lighter thresholds.
  const midpoint = (min + max) * 0.5;
  const thresholds = [midpoint, midpoint - 18, midpoint + 18];

  for (const threshold of thresholds) {
    const result = decodeRuns(rowToRuns(gray, width, y, threshold));
    if (result) return result;
  }
  return null;
}

/**
 * Decode Code 128 from a small grayscale canvas.
 * Several horizontal rows are sampled because a camera image can be tilted,
 * slightly blurred, or have glare across one part of the barcode.
 */
export function decodeCode128(imageData, sampleRows = 9) {
  const { width, height, data } = imageData;
  if (!width || !height) return null;

  const gray = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i += 1, p += 4) {
    gray[i] = Math.round(data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114);
  }

  const center = Math.floor(height * 0.5);
  const step = Math.max(2, Math.floor(height * 0.06));
  const offsets = [];
  for (let i = 0; i < sampleRows; i += 1) offsets.push((i - Math.floor(sampleRows / 2)) * step);

  for (const offset of offsets) {
    const y = Math.max(0, Math.min(height - 1, center + offset));
    const result = decodeRow(gray, width, y);
    if (result) return result;
  }

  return null;
}
