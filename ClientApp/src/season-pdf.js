import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";

const money = (value) => `DOP ${Number(value || 0).toLocaleString("en-US")}`;

export function createSeasonPdf(archive) {
  const doc = new jsPDF();
  const margin = 16;
  function heading(title, subtitle) {
    doc.setFillColor("#006747");
    doc.rect(0, 0, 210, 35, "F");
    doc.setTextColor("#f3ebd4");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("Tour Virtual Hoyo 20", margin, 15);
    doc.setFontSize(11);
    doc.text(title, margin, 25);
    doc.setTextColor("#2d2d2d");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    const lines = doc.splitTextToSize(subtitle, 178);
    doc.text(lines, margin, 44);
    return 49 + lines.length * 4;
  }
  function table(startY, head, body) {
    autoTable(doc, {
      startY, head: [head], body,
      margin: { left: margin, right: margin, top: 18, bottom: 18 },
      styles: { font: "helvetica", fontSize: 9, cellPadding: 3, overflow: "linebreak" },
      headStyles: { fillColor: "#006747", textColor: "#f3ebd4" },
      alternateRowStyles: { fillColor: "#f3ebd4" },
      rowPageBreak: "avoid",
    });
  }
  let y = heading("Clasificación overall", `${archive.name} | Categoría ${archive.category}\nArchivada: ${new Date(archive.archivedAt).toLocaleDateString("es-DO")} | Inicio: ${archive.snapshot.startDate || "Sin fecha"}`);
  table(y, ["Lugar", "Equipo", "Integrantes", "Puntos", "Premios totales"], archive.results.map((team, index) => [
    index + 1, team.name,
    Object.entries(team.members || {}).map(([category, name]) => `${category}: ${name || "TBD"}`).join("\n"),
    team.points, money(team.money),
  ]));
  doc.addPage();
  y = heading("Inscripciones", `${archive.name}\nInscripción: ${money(archive.inscriptionFee)} | Aporte por inscripción pagada a la final: ${money(archive.inscriptionFinalPool)}\nDonación final: ${money(archive.snapshot.finalDonation)}`);
  table(y, ["Equipo", "Estado", "Monto recibido"], archive.results.map((team) => [team.name, team.inscriptionPaid ? "Pagada" : "Pendiente", money(team.inscriptionPaid ? archive.inscriptionFee : 0)]));
  archive.weeks.forEach((week, index) => {
    doc.addPage();
    const fee = index === archive.weeks.length - 1 ? archive.snapshot.finalWeekFee : archive.regularFee;
    y = heading(week.name + (week.doublePoints ? " | Puntos x2" : ""), `${archive.name}\nBolsa: ${money(week.pool)} | Cuota por equipo: ${money(fee)}`);
    const rows = [...archive.results].sort((a, b) => (a.weeks[index].place ?? Infinity) - (b.weeks[index].place ?? Infinity));
    table(y, ["Equipo", "Lugar", "Score", "Puntos", "Premio", "Pago", "Recibido"], rows.map((team) => {
      const result = team.weeks[index];
      return [team.name, result.place ?? "TBD", result.score || "TBD", result.points, money(result.money), result.paid ? "Pagado" : "Pendiente", money(result.paid ? fee : 0)];
    }));
  });
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setFontSize(8);
    doc.setTextColor("#555555");
    doc.text(`Tour Virtual Hoyo 20 | ${page} / ${pages}`, margin, 287);
  }
  return doc;
}

export function downloadSeasonPdf(archive) {
  const filename = archive.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "temporada";
  createSeasonPdf(archive).save(`tour-hoyo20-${filename}.pdf`);
}
