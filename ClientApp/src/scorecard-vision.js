import { lastPlayedScores } from "./simulator-ocr.js";

export function validateVisionCard(payload) {
  if (!Array.isArray(payload?.par) || payload.par.length !== 18 || !Array.isArray(payload.groups)) return [];
  return payload.groups.slice(0, 6).map(group => {
    const names = Array.isArray(group?.names) ? group.names.filter(n => typeof n === "string")
      .map(n => n.trim().slice(0, 80)).filter(Boolean).slice(0, 3) : [];
    const invalid = { names, score: "", holes: {}, issue: "No se pudieron verificar los golpes con el total impreso." };
    if (!names.length || !Array.isArray(group.strokes) || group.strokes.length !== 18) return invalid;
    const played = [];
    let gross = 0, par = 0, out = 0, back = 0;
    for (let i = 0; i < 18; i++) {
      const strokes = group.strokes[i];
      if (strokes === null) continue;
      const holePar = payload.par[i];
      if (!Number.isInteger(strokes) || strokes < 1 || strokes > 12 || !Number.isInteger(holePar) || holePar < 3 || holePar > 6) return invalid;
      gross += strokes;
      par += holePar;
      if (i < 9) out += strokes;
      else back += strokes;
      played.push([i + 1, strokes - holePar]);
    }
    if (!played.length || !Number.isInteger(group.gross) || gross !== group.gross ||
      group.out !== null && group.out !== out || group.in !== null && group.in !== back ||
      group.relative !== null && group.relative !== gross - par) return invalid;
    const score = gross - par;
    const holes = lastPlayedScores(played);
    return { names, score: score === 0 ? "E" : score > 0 ? `+${score}` : String(score), holes,
      issue: group.uncertain !== false ? "Revisa la lectura de esta tarjeta." :
        played.length < 3 ? "Revisa los \u00faltimos tres hoyos jugados." : "" };
  });
}

export async function visionPhoto(file) {
  const bitmap = await createImageBitmap(file);
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 60_000_000) throw new Error("Foto demasiado grande.");
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Foto no v\u00e1lida.")), "image/jpeg", .94));
  } finally { bitmap.close(); }
}
