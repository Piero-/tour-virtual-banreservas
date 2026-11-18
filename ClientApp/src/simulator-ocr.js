const center = word => ({
  text: word.text.trim(), x: (word.bbox.x0 + word.bbox.x1) / 2,
  y: (word.bbox.y0 + word.bbox.y1) / 2,
});

export function focusScorecardImage(image) {
  const bands = [];
  let band;
  // The simulator's wide blue header is distinct from the narrow HUD panels.
  for (let y = 0; y < image.height; y += 2) {
    let start = -1, last = -1, best = null;
    const gap = Math.max(8, image.width * .025);
    for (let x = 0; x < image.width; x += 2) {
      const p = (y * image.width + x) * 4;
      const [r, g, b] = image.data.subarray(p, p + 3);
      if (b > 55 && b > r * 1.22 && b > g * 1.15) {
        if (start < 0 || x - last > gap) start = x;
        last = x;
        if (!best || x - start > best.right - best.left) best = { left: start, right: x };
      }
    }
    if (best && best.right - best.left > image.width * .5) {
      if (!band || y - band.bottom > 6) {
        band = { top: y, bottom: y, rows: [] };
        bands.push(band);
      }
      band.bottom = y;
      band.rows.push(best);
    }
  }
  const header = bands.filter(item => item.bottom - item.top > image.height * .015)
    .sort((a, b) => b.rows.length - a.rows.length)[0];
  if (!header) return image;
  const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const left = Math.max(0, median(header.rows.map(row => row.left)) - 6);
  const right = Math.min(image.width, median(header.rows.map(row => row.right)) + 8);
  const top = Math.max(0, header.top - 4);
  const bottom = Math.min(image.height, header.bottom + (right - left) * .34);
  if (right - left < image.width * .5 || bottom - top < 100) return image;
  const width = 1200, scale = (right - left) / width;
  const height = Math.round((bottom - top) / scale);
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sx = Math.min(image.width - 1, left + x * scale), sy = Math.min(image.height - 1, top + y * scale);
    const x0 = Math.floor(sx), y0 = Math.floor(sy), dx = sx - x0, dy = sy - y0;
    const x1 = Math.min(image.width - 1, x0 + 1), y1 = Math.min(image.height - 1, y0 + 1);
    const p = (y * width + x) * 4;
    for (let c = 0; c < 3; c++) data[p + c] =
      image.data[(y0 * image.width + x0) * 4 + c] * (1 - dx) * (1 - dy) +
      image.data[(y0 * image.width + x1) * 4 + c] * dx * (1 - dy) +
      image.data[(y1 * image.width + x0) * 4 + c] * (1 - dx) * dy +
      image.data[(y1 * image.width + x1) * 4 + c] * dx * dy;
  }
  return { width, height, data };
}

export function simulatorGrid(words) {
  const points = words.map(center);
  const index = points.find(point => /^(INDEX|[I1L]NDEX)$/i.test(point.text));
  const distance = points.find(point => /^DISTANCE$/i.test(point.text) && point.y > index?.y && Math.abs(point.x - index.x) < 65);
  if (!distance) return rectangularGrid(points);
  const rowStep = distance.y - index.y;
  const header = points.find(point => /^(HOLE|HOYO)$/i.test(point.text) && point.y < index.y)
    || { x: index.x, y: index.y - 2 * rowStep };
  const near = points.filter(point => point.x > header.x + rowStep && Math.abs(point.y - header.y) < rowStep * .75);
  const h8 = near.find(point => point.text === "8");
  const h2 = near.find(point => point.text === "2" && point.x < h8?.x);
  const h17 = near.find(point => point.text === "17" && point.x > h8?.x);
  const h18 = near.find(point => point.text === "18" || (point.text === "1B" && h17 &&
    point.x - h17.x > rowStep * .7 && point.x - h17.x < rowStep * 1.5));
  const rightAnchor = h18 || h17;
  if (!h8 || !rightAnchor) return rectangularGrid(points);
  const leftAnchor = h2 || h8;
  const leftSlot = h2 ? 1 : 7;
  const rightSlot = h18 ? 18 : 17;
  const step = (rightAnchor.x - leftAnchor.x) / (rightSlot - leftSlot);
  if (step < 8) return null;
  const x0 = leftAnchor.x - step * leftSlot;
  const slope = (rightAnchor.y - leftAnchor.y) / (rightAnchor.x - leftAnchor.x);
  const distanceWords = points.filter(point => /^\d{3,5}$/.test(point.text) && point.x > x0 - step * .5 &&
    Math.abs(point.y - distance.y - slope * (point.x - distance.x)) < rowStep * .4);
  const offset = column => {
    const x = x0 + column * step;
    const match = distanceWords.find(point => Math.abs(point.x - x) < step * .43);
    return match ? match.x - x : null;
  };
  const left = offset(0) ?? offset(1) ?? 0;
  const right = offset(20) ?? offset(19) ?? offset(18) ?? 0;
  return { step, rowStep, x0, slope, distance, left, right };
}

function rectangularGrid(points) {
  const label = points.find(point => /Distance$/i.test(point.text));
  const header = points.find(point => /^Hole$/i.test(point.text) && point.y < label?.y && label.y - point.y < 160);
  if (!label || !header) return null;
  const distances = points.filter(point => /^[\dSs][\dSsaABBOIl]{2,3}$/.test(point.text) && point.x > header.x + 90 &&
    Math.abs(point.y - label.y) < 16).sort((a, b) => a.x - b.x);
  if (distances.length < 16) return null;
  const first = distances[0], second = distances[1];
  const step = second.x - first.x;
  if (step < 12 || step > 65) return null;
  const slots = Array(21);
  let slot = 0;
  for (const point of distances) {
    if (point.x - first.x > step * 21) break;
    if (slot && point.x - slots[slot - 1] > step * 1.5) slot++;
    if (slot > 20) break;
    slots[slot++] = point.x;
  }
  for (let i = 0; i < 21; i++) if (slots[i] === undefined) {
    slots[i] = i > 1 ? slots[i - 1] + (slots[i - 1] - slots[i - 2]) : first.x + step * i;
  }
  const holeOne = points.find(point => point.text === "1" && Math.abs(point.x - first.x) < step * .3 &&
    Math.abs(point.y - header.y) < 20);
  const parOne = points.find(point => /^[3-6]$/.test(point.text) && Math.abs(point.x - first.x) < step * .3 &&
    point.y > (holeOne?.y ?? header.y) + step * .45 && point.y < (holeOne?.y ?? header.y) + step * 1.3);
  if (!parOne) return null;
  const rowStep = holeOne ? parOne.y - holeOne.y : (first.y - parOne.y) / 2;
  const parPoints = points.filter(point => /^[3-6]$/.test(point.text) && point.x >= first.x - step * .3 &&
    point.x <= slots[18] + step * .3 && Math.abs(point.y - parOne.y) < rowStep * .35);
  const slopes = parPoints.flatMap((a, i) => parPoints.slice(i + 1).filter(b => b.x - a.x > step * 5)
    .map(b => (b.y - a.y) / (b.x - a.x))).sort((a, b) => a - b);
  const slope = slopes[Math.floor(slopes.length / 2)] ?? 0;
  return { rectangular: true, step, rowStep, x0: first.x, slope,
    rowSlope: slope > .004 ? .003 : 0, left: 2, right: -2,
    nameX: header.x, columns: slots, distance: { x: first.x, y: parOne.y + 2 * rowStep } };
}

const CELL_W = 92, CELL_H = 76, PAD = 20;
export function lastPlayedScores(played) {
  return Object.fromEntries(played.slice(-3).map(([, delta], index, last) => [19 - last.length + index, delta]));
}
export function refineScorecardGrid(image, grid) {
  if (!grid.rectangular) return grid;
  const brightness = (x, y) => {
    let sum = 0;
    for (let dx = -4; dx <= 4; dx++) {
      const p = (Math.round(y) * image.width + Math.max(0, Math.min(image.width - 1, Math.round(x) + dx))) * 4;
      sum += (image.data[p] + image.data[p + 1] + image.data[p + 2]) / 3;
    }
    return sum / 9;
  };
  const leftX = grid.x0 - grid.step * .7;
  const rightX = grid.columns[20] + grid.step * .27;
  const boundaries = x => {
    let start;
    for (let y = Math.round(grid.distance.y + grid.rowStep * .3); y < grid.distance.y + grid.rowStep; y++) {
      if (brightness(x, y) > 185 && brightness(x, y + 3) > 185) { start = y; break; }
    }
    if (start === undefined) return null;
    const edges = [start];
    let step = grid.rowStep;
    for (let i = 1; i <= 6; i++) {
      const expected = edges.at(-1) + step;
      const candidates = [];
      for (let y = Math.round(expected - step * .22); y <= expected + step * .22 && y < image.height - 4; y++) {
        const contrast = (brightness(x, y - 3) + brightness(x, y + 3)) / 2 - brightness(x, y);
        if (contrast > 24) candidates.push({ y, contrast });
      }
      const best = candidates.sort((a, b) => b.contrast - a.contrast)[0];
      if (!best) return null;
      edges.push(best.y);
      step = (edges.at(-1) - start) / i;
    }
    return edges;
  };
  const left = boundaries(leftX), right = boundaries(rightX);
  if (!left || !right) return grid;
  return { ...grid, rowGeometry: { leftX, rightX, left, right } };
}
export function simulatorAtlas(image, grid) {
  const width = PAD * 2 + CELL_W * 21, height = PAD * 2 + CELL_H * 7;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const rgb = (x, y) => {
    const offset = (Math.round(y) * image.width + Math.round(x)) * 4;
    return [image.data[offset] ?? 255, image.data[offset + 1] ?? 255, image.data[offset + 2] ?? 255];
  };
  for (let row = 0; row < 7; row++) for (let column = 0; column < 21; column++) {
    const count = row === 0 ? -2 : row;
    const xShift = (grid.left + (grid.right - grid.left) * column / 20) * (3 + count) / 3;
    const x = (grid.columns?.[column] ?? grid.x0 + column * grid.step) + xShift;
    const slope = grid.slope - (grid.rectangular ? grid.rowSlope * count : 0);
    let y = grid.distance.y + slope * (x - grid.distance.x) + count * grid.rowStep * (grid.rectangular ? 1 : 1 - .035 * Math.max(0, count - 1) / 5);
    if (row > 0 && grid.rowGeometry) {
      const { leftX, rightX, left, right } = grid.rowGeometry;
      const l = (left[row - 1] + left[row]) / 2, r = (right[row - 1] + right[row]) / 2;
      y = l + (r - l) * (x - leftX) / (rightX - leftX);
    }
    let colored = 0;
    for (const dx of [-.13, .13]) for (const dy of [-.18, .18]) {
      const [r, g, b] = rgb(x + dx * grid.step, y + dy * grid.rowStep);
      if ((r > g * 1.28 && r > b * 1.16) || (r < 105 && g < 135 && b > r * 1.2) ||
          (grid.rectangular && (r > b * 1.5 && g > b * 1.5 || b > Math.max(r, g) * 1.15 || Math.max(r, g, b) < 140))) colored++;
    }
    const inverse = colored >= 2;
    const background = [-.25, .25].flatMap(dx => [-.28, .28].map(dy => {
      const [r, g, b] = rgb(x + dx * grid.step, y + dy * grid.rowStep);
      return (r + g + b) / 3;
    })).sort((a, b) => a - b)[2];
    const inverseBackground = [-.25, .25].flatMap(dx => [-.28, .28].map(dy =>
      Math.min(...rgb(x + dx * grid.step, y + dy * grid.rowStep)))).sort((a, b) => a - b)[1];
    for (let iy = 0; iy < 43; iy++) for (let ix = 0; ix < 66; ix++) {
      const [r, g, b] = rgb(x + (ix - 33) * grid.step / 90, y + (iy - 21.5) * grid.rowStep / 82);
      if (grid.rectangular) {
        if (column < 19 && column !== 9 && Math.abs(ix - 33) >= 20) continue;
        const contrast = inverse ? Math.min(r, g, b) - inverseBackground : background - (r + g + b) / 3;
        const value = Math.max(0, Math.min(255, 255 - Math.max(0, contrast - 12) * 2));
        const p = ((PAD + row * CELL_H + 16 + iy) * width + PAD + column * CELL_W + 13 + ix) * 4;
        data[p] = data[p + 1] = data[p + 2] = value;
        continue;
      }
      const ink = inverse ? Math.abs(ix - 33) < 16 && Math.min(r, g, b) > 148
        : (r + g + b) / 3 < (grid.rectangular ? background - 28 : 153) &&
          (column === 9 || column >= 19 || Math.abs(ix - 33) < 20);
      if (!ink) continue;
      const p = ((PAD + row * CELL_H + 16 + iy) * width + PAD + column * CELL_W + 13 + ix) * 4;
      data[p] = data[p + 1] = data[p + 2] = 0;
    }
  }
  return { width, height, data, rectangular: !!grid.rectangular };
}

export async function recognizeSimulatorDigits(worker, encode, atlas, onProgress) {
  const digits = [];
  let visited = 0;
  for (let row = 0; row < 7; row++) for (let column = 0; column < 21; column++) {
    if (!atlas.rectangular && [9, 19].includes(column)) continue;
    onProgress?.(++visited / (7 * (atlas.rectangular ? 21 : 19)));
    const left = PAD + column * CELL_W, top = PAD + row * CELL_H;
    let minX = Infinity, maxX = -1, minY = Infinity, maxY = -1;
    for (let y = top + 16; y < top + 59; y++) {
      for (let x = left + 13; x < left + 79; x++) if (atlas.data[(y * atlas.width + x) * 4] < 180) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
    if (maxY - minY < 8) continue;
    const width = (maxX - minX + 1) * 2 + 28, height = (maxY - minY + 1) * 2 + 28;
    const data = new Uint8ClampedArray(width * height * 4).fill(255);
    for (let y = 14; y < height - 14; y++) for (let x = 14; x < width - 14; x++) {
      const ink = atlas.data[((minY + ((y - 14) >> 1)) * atlas.width + minX + ((x - 14) >> 1)) * 4];
      const p = (y * width + x) * 4;
      data[p] = data[p + 1] = data[p + 2] = ink;
    }
    const image = encode({ width, height, data });
    let text = "";
    for (const mode of atlas.rectangular ? ["13", "7", "10", "8", "6"] : ["8", "10", "6"]) {
      const result = await worker.recognize(image, { tessedit_pageseg_mode: mode, tessedit_char_whitelist: "0123456789" });
      const value = result.data.text.trim();
      if (column === 20 || atlas.rectangular && [9, 19].includes(column) ? /^\d{2,3}$/.test(value) : row === 0 ? /^[3-6]$/.test(value) : /^\d{1,2}$/.test(value)) {
        text = value;
        break;
      }
    }
    if (/^\d{1,3}$/.test(text)) digits.push({ text, bbox: { x0: left, y0: top, x1: left + CELL_W, y1: top + CELL_H } });
  }
  return digits;
}

export function readScrambleAtlas(digits, names) {
  const cells = Array.from({ length: 7 }, () => new Map());
  for (const digit of digits.map(center)) {
    const row = Math.floor((digit.y - PAD) / CELL_H);
    const column = Math.floor((digit.x - PAD) / CELL_W);
    cells[row]?.set(column, Number(digit.text));
  }
  const columns = Array.from({ length: 21 }, (_, i) => i).filter(i => ![9, 19, 20].includes(i));
  const pars = columns.map(column => cells[0].get(column));
  const missing = pars.map((par, i) => par >= 3 && par <= 6 ? -1 : i).filter(i => i >= 0);
  const parTotal = cells[0].get(20);
  if (missing.length === 1 && parTotal) pars[missing[0]] = parTotal - pars.reduce((sum, par, i) => sum + (i === missing[0] ? 0 : par), 0);
  if (pars.some(par => !(par >= 3 && par <= 6)) || (parTotal && pars.reduce((a, b) => a + b, 0) !== parTotal)) return [];
  const results = [];
  for (let first = 1; first <= 4; first += 3) {
    const group = cells.slice(first, first + 3);
    for (const [start, end, totalColumn] of [[0, 8, 9], [10, 18, 19]]) {
      const consensus = column => {
        const counts = new Map();
        for (const row of group) if (row.has(column)) counts.set(row.get(column), (counts.get(row.get(column)) ?? 0) + 1);
        return [...counts].find(([, count]) => count >= 2)?.[0];
      };
      const subtotal = consensus(totalColumn);
      if (!subtotal) continue;
      const uncertain = [], confirmed = new Map();
      for (let column = start; column <= end; column++) {
        const value = consensus(column);
        if (value >= 1 && value <= 12) confirmed.set(column, value);
        else if (group.some(row => row.has(column))) uncertain.push(column);
      }
      if (uncertain.length !== 1) continue;
      const missing = subtotal - [...confirmed.values()].reduce((a, b) => a + b, 0);
      if (missing < 1 || missing > 12) continue;
      confirmed.set(uncertain[0], missing);
      for (const row of group) for (const [column, value] of confirmed) row.set(column, value);
    }
    const players = names.slice(first - 1, first + 2).filter(Boolean);
    if (!players.length || !group.some(row => row.size)) continue;
    const grossCounts = new Map();
    for (const row of group) {
      const gross = row.get(20);
      if (gross >= 10 && gross <= 180) grossCounts.set(gross, (grossCounts.get(gross) || 0) + 1);
    }
    const gross = [...grossCounts].find(([, count]) => count >= 2)?.[0];
    const choices = columns.map(column => [...new Set(group.map(row => row.get(column)).filter(n => n >= 1 && n <= 12))]);
    const outcomes = new Map();
    for (const row of group) {
      const strokes = columns.map(column => row.get(column));
      if (row.get(20) !== gross || strokes.some(n => n !== undefined && !(n >= 1 && n <= 12)) ||
          strokes.reduce((sum, n) => sum + (n ?? 0), 0) !== gross) continue;
      const playedPar = strokes.reduce((sum, n, index) => sum + (n ? pars[index] : 0), 0);
      const last = lastPlayedScores(strokes.flatMap((value, index) => value ? [[index + 1, value - pars[index]]] : []));
      outcomes.set(JSON.stringify([playedPar, last]), { playedPar, last });
    }
    let attempts = 0;
    const walk = (index, sum, playedPar, played) => {
      if (++attempts > 20000 || sum > gross || outcomes.size > 1) return;
      if (index === 18) {
        const last = lastPlayedScores(played);
        if (sum === gross) outcomes.set(JSON.stringify([playedPar, last]), { playedPar, last });
        return;
      }
      if (!choices[index].length) return walk(index + 1, sum, playedPar, played);
      for (const strokes of choices[index]) {
        const hole = index + 1;
        walk(index + 1, sum + strokes, playedPar + pars[index], [...played, [hole, strokes - pars[index]]]);
      }
    };
    if (gross && !outcomes.size) walk(0, 0, 0, []);
    if (outcomes.size !== 1 || attempts > 20000) {
      results.push({ names: players, score: "", holes: {}, issue: "Los golpes leídos no se pudieron verificar con el total impreso." });
      continue;
    }
    const { playedPar, last } = outcomes.values().next().value;
    const relative = gross - playedPar;
    const holes = Object.fromEntries(Object.entries(last).filter(([, delta]) => delta >= -3 && delta <= 2));
    results.push({ names: players, score: relative === 0 ? "E" : relative > 0 ? `+${relative}` : String(relative), holes,
      issue: Object.keys(holes).length !== 3 ? "Revisa los últimos tres hoyos jugados." : "" });
  }
  return results;
}

export async function recognizeSimulatorNames(worker, file, grid, image, encode) {
  const names = [];
  for (let row = 1; row <= 6; row++) {
    if (grid.rectangular && image && encode) {
      const left = Math.round(grid.nameX - grid.step * .18 + row * .9);
      const rowY = grid.rowGeometry ? (grid.rowGeometry.left[row - 1] + grid.rowGeometry.left[row]) / 2 :
        grid.distance.y + row * grid.rowStep;
      const top = Math.round(rowY - grid.rowStep * .3);
      const cropWidth = Math.round(grid.x0 - left - grid.step * .6), cropHeight = Math.round(grid.rowStep * .58);
      const width = cropWidth * 3 + 24, height = cropHeight * 3 + 24;
      const data = new Uint8ClampedArray(width * height * 4).fill(255);
      for (let y = 0; y < cropHeight * 3; y++) for (let x = 0; x < cropWidth * 3; x++) {
        const p = ((top + Math.floor(y / 3)) * image.width + left + Math.floor(x / 3)) * 4;
        const brightness = (image.data[p] + image.data[p + 1] + image.data[p + 2]) / 3;
        const value = Math.max(0, Math.min(255, (brightness - 140) * 3));
        const dest = ((y + 12) * width + x + 12) * 4;
        data[dest] = data[dest + 1] = data[dest + 2] = value;
      }
      const result = await worker.recognize(encode({ width, height, data }),
        { tessedit_pageseg_mode: "7", tessedit_char_whitelist: "" });
      names.push(result.data.text.trim().replace(/[^\p{L}\p{M} '.-]/gu, "").trim());
      continue;
    }
    const left = Math.max(0, Math.round((grid.nameX ?? grid.distance.x) - grid.step * 1.3));
    const rectangle = { left, top: Math.round(grid.distance.y + row * grid.rowStep - grid.rowStep * .48),
      width: Math.round(grid.x0 - left - grid.step), height: Math.round(grid.rowStep * .87) };
    const result = await worker.recognize(file, { rectangle, tessedit_pageseg_mode: "7", tessedit_char_whitelist: "" });
    names.push(result.data.text.trim().replace(/[^\p{L}\p{M} '.-]/gu, "").trim());
  }
  return names;
}
