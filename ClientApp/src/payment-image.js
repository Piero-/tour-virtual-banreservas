export function paymentImageRows(data) {
  return (data.teams || []).slice(0, 20).map(team => ({
    name: String(team.name || ""), paymentName: String(team.paymentName || ""),
    inscriptionPaid: team.inscriptionPaid === true, weekPaid: team.weekPaid === true,
  }));
}

export function wrapImageText(ctx, value, width) {
  const lines = [];
  let line = "";
  for (const word of String(value).split(/\s+/).filter(Boolean)) {
    if (line && ctx.measureText(`${line} ${word}`).width <= width) { line += ` ${word}`; continue; }
    if (line) lines.push(line);
    line = "";
    for (const char of word) {
      if (line && ctx.measureText(line + char).width > width) { lines.push(line); line = ""; }
      line += char;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export async function createPaymentImage(data) {
  await document.fonts?.ready;
  const width = 520, margin = 16, teamWidth = 256, columnWidth = 116;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const font = getComputedStyle(document.querySelector("#paymentTable") || document.body).fontFamily;
  const rows = paymentImageRows(data).map(team => {
    ctx.font = `750 14px ${font}`;
    const nameWidth = team.paymentName ? Math.min(128, Math.max(72, ctx.measureText(team.name).width)) : teamWidth - 24;
    const name = wrapImageText(ctx, team.name, nameWidth);
    const tagWidth = teamWidth - 34 - nameWidth;
    ctx.font = `400 12px ${font}`;
    const associated = wrapImageText(ctx, team.paymentName, tagWidth - 16);
    return { ...team, name, nameWidth, tagWidth, associated,
      height: Math.max(42, 20 + Math.max(name.length * 18, associated.length ? associated.length * 17 + 4 : 0)) };
  });
  ctx.font = `800 11px ${font}`;
  const week = wrapImageText(ctx, String(data.weekLabel), columnWidth - 12);
  const headerHeight = Math.max(64, 30 + week.length * 15);
  const tableTop = 88, height = tableTop + headerHeight + rows.reduce((sum, row) => sum + row.height, 0) + margin;
  canvas.width = width * 2; canvas.height = height * 2;
  ctx.scale(2, 2);
  ctx.fillStyle = "#0b1f17"; ctx.fillRect(0, 0, width, height);
  ctx.textBaseline = "top";
  ctx.fillStyle = "#b8c9be"; ctx.font = `800 10px ${font}`;
  ctx.fillText("PAGOS", margin + 12, 18);
  ctx.fillStyle = "#f3ebd4"; ctx.font = `800 18px ${font}`;
  ctx.fillText("Tour Virtual Hoyo 20", margin + 12, 35);
  ctx.fillStyle = "#b8c9be"; ctx.font = `500 11px ${font}`;
  ctx.fillText(`Categoría ${data.category}`, margin + 12, 61);
  const tableWidth = width - margin * 2;
  ctx.fillStyle = "#1d332a"; ctx.fillRect(margin, tableTop, tableWidth, headerHeight);
  const centers = [margin + teamWidth + columnWidth / 2, margin + teamWidth + columnWidth * 1.5];
  ctx.fillStyle = "#f3ebd4"; ctx.font = `800 11px ${font}`;
  ctx.fillText("EQUIPO", margin + 12, tableTop + 20);
  ctx.textAlign = "center";
  ctx.fillText("INSCRIPCIÓN", centers[0], tableTop + 16);
  week.forEach((text, i) => ctx.fillText(text.toUpperCase(), centers[1], tableTop + 16 + i * 15));
  ctx.fillStyle = "#e5c08b"; ctx.font = `800 11px ${font}`;
  ctx.fillText(String(data.inscriptionFee), centers[0], tableTop + headerHeight - 22);
  ctx.fillText(String(data.weekFee), centers[1], tableTop + headerHeight - 22);
  const checkbox = (x, y, paid) => {
    ctx.beginPath();ctx.roundRect(x - 11, y - 11, 22, 22, 6);
    ctx.fillStyle = paid ? "#006747" : "#293b33";ctx.fill();
    ctx.strokeStyle = paid ? "#79bf9f" : "#718479";ctx.lineWidth = 1;ctx.stroke();
    if (paid) {
      ctx.beginPath();ctx.moveTo(x - 5, y);ctx.lineTo(x - 1, y + 4);ctx.lineTo(x + 6, y - 5);
      ctx.strokeStyle = "#fff8e5";ctx.lineWidth = 2.5;ctx.lineCap = "round";ctx.lineJoin = "round";ctx.stroke();
    }
  };
  let y = tableTop + headerHeight;
  for (const row of rows) {
    ctx.fillStyle = "#101f19";ctx.fillRect(margin, y, tableWidth, row.height);
    ctx.textAlign = "left";ctx.fillStyle = "#f3ebd4";ctx.font = `750 14px ${font}`;
    row.name.forEach((line, i) => ctx.fillText(line, margin + 12, y + (row.height - row.name.length * 18) / 2 + i * 18));
    if (row.associated.length) {
      const top = y + (row.height - row.associated.length * 17 - 4) / 2;
      const left = margin + 12 + row.nameWidth + 10;
      ctx.font = `400 12px ${font}`;
      const pillWidth = Math.min(row.tagWidth, Math.max(...row.associated.map(line => ctx.measureText(line).width)) + 16);
      ctx.beginPath();ctx.roundRect(left, top, pillWidth, row.associated.length * 17 + 4, 7);
      ctx.fillStyle = "#1d2d24";ctx.fill();ctx.strokeStyle = "#30463a";ctx.lineWidth = 1;ctx.stroke();
      ctx.fillStyle = "#b8c9be";
      row.associated.forEach((line, i) => ctx.fillText(line, left + 8, top + 3 + i * 17));
    }
    checkbox(centers[0], y + row.height / 2, row.inscriptionPaid);
    checkbox(centers[1], y + row.height / 2, row.weekPaid);
    ctx.beginPath();ctx.moveTo(margin, y + row.height);ctx.lineTo(width - margin, y + row.height);
    ctx.strokeStyle = "#30463a";ctx.lineWidth = 1;ctx.stroke();
    y += row.height;
  }
  ctx.beginPath();ctx.roundRect(margin, tableTop, tableWidth, y - tableTop, 7);
  ctx.strokeStyle = "#456353";ctx.lineWidth = 1;ctx.stroke();
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("No se pudo crear la imagen.")), "image/png"));
}
