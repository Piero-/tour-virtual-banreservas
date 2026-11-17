const center = word => ({
  text: word.text.trim(), x: (word.bbox.x0 + word.bbox.x1) / 2,
  y: (word.bbox.y0 + word.bbox.y1) / 2,
});

export function simulatorGrid(words) {
  const points = words.map(center);
  const index = points.find(point => /^(INDEX|[I1L]NDEX)$/i.test(point.text));
  const distance = points.find(point => /^DISTANCE$/i.test(point.text) && point.y > index?.y && Math.abs(point.x - index.x) < 65);
  if (!distance) return null;
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
  if (!h8 || !rightAnchor) return null;
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

const CELL_W = 92, CELL_H = 76, PAD = 20;
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
    const x = grid.x0 + column * grid.step + xShift;
    const y = grid.distance.y + grid.slope * (x - grid.distance.x) + count * grid.rowStep * (1 - .035 * Math.max(0, count - 1) / 5);
    let colored = 0;
    for (const dx of [-.13, .13]) for (const dy of [-.18, .18]) {
      const [r, g, b] = rgb(x + dx * grid.step, y + dy * grid.rowStep);
      if ((r > g * 1.28 && r > b * 1.16) || (r < 105 && g < 135 && b > r * 1.2)) colored++;
    }
    const inverse = colored >= 2;
    for (let iy = 0; iy < 43; iy++) for (let ix = 0; ix < 66; ix++) {
      const [r, g, b] = rgb(x + (ix - 33) * grid.step / 90, y + (iy - 21.5) * grid.rowStep / 82);
      const ink = inverse ? Math.abs(ix - 33) < 16 && Math.min(r, g, b) > 148
        : (r + g + b) / 3 < 153 && (column === 9 || column >= 19 || Math.abs(ix - 33) < 20);
      if (!ink) continue;
      const p = ((PAD + row * CELL_H + 16 + iy) * width + PAD + column * CELL_W + 13 + ix) * 4;
      data[p] = data[p + 1] = data[p + 2] = 0;
    }
  }
  return { width, height, data };
}

export async function recognizeSimulatorDigits(worker, encode, atlas, onProgress) {
  const digits = [];
  let visited = 0;
  for (let row = 0; row < 7; row++) for (let column = 0; column < 21; column++) {
    if ([9, 19].includes(column)) continue;
    onProgress?.(++visited / (7 * 19));
    const left = PAD + column * CELL_W, top = PAD + row * CELL_H;
    let minX = Infinity, maxX = -1, minY = Infinity, maxY = -1;
    for (let y = top + 16; y < top + 59; y++) {
      for (let x = left + 13; x < left + 79; x++) if (!atlas.data[(y * atlas.width + x) * 4]) {
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
    for (const mode of ["8", "10", "6"]) {
      const result = await worker.recognize(image, { tessedit_pageseg_mode: mode, tessedit_char_whitelist: "0123456789" });
      const value = result.data.text.trim();
      if (column === 20 ? /^\d{2,3}$/.test(value) : row === 0 ? /^[3-6]$/.test(value) : /^\d{1,2}$/.test(value)) {
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
      const last = Object.fromEntries([15, 16, 17].filter(index => strokes[index]).map(index => [index + 1, strokes[index] - pars[index]]));
      outcomes.set(JSON.stringify([playedPar, last]), { playedPar, last });
    }
    let attempts = 0;
    const walk = (index, sum, playedPar, last) => {
      if (++attempts > 20000 || sum > gross || outcomes.size > 1) return;
      if (index === 18) {
        if (sum === gross) outcomes.set(JSON.stringify([playedPar, last]), { playedPar, last });
        return;
      }
      if (!choices[index].length) return walk(index + 1, sum, playedPar, last);
      for (const strokes of choices[index]) {
        const hole = index + 1;
        walk(index + 1, sum + strokes, playedPar + pars[index], hole >= 16 ? { ...last, [hole]: strokes - pars[index] } : last);
      }
    };
    if (gross && !outcomes.size) walk(0, 0, 0, {});
    if (outcomes.size !== 1 || attempts > 20000) {
      results.push({ names: players, score: "", holes: {}, issue: "Los golpes leídos no se pudieron verificar con el total impreso." });
      continue;
    }
    const { playedPar, last } = outcomes.values().next().value;
    const relative = gross - playedPar;
    const holes = Object.fromEntries(Object.entries(last).filter(([, delta]) => delta >= -3 && delta <= 2));
    results.push({ names: players, score: relative === 0 ? "E" : relative > 0 ? `+${relative}` : String(relative), holes,
      issue: Object.keys(holes).length !== 3 ? "Revisa los hoyos 16, 17 y 18." : "" });
  }
  return results;
}

export async function recognizeSimulatorNames(worker, file, grid) {
  const names = [];
  for (let row = 1; row <= 6; row++) {
    const left = Math.max(0, Math.round(grid.distance.x - grid.step * 1.3));
    const rectangle = { left, top: Math.round(grid.distance.y + row * grid.rowStep - grid.rowStep * .48),
      width: Math.round(grid.x0 - left - grid.step), height: Math.round(grid.rowStep * .87) };
    const result = await worker.recognize(file, { rectangle, tessedit_pageseg_mode: "7", tessedit_char_whitelist: "" });
    names.push(result.data.text.trim().replace(/[^\p{L}\p{M} '.-]/gu, "").trim());
  }
  return names;
}
