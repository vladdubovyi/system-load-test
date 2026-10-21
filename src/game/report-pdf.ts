import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { SimulationReport } from './types';
import { formatCost, formatSeconds } from './report';
import { SCENARIO } from './types';

function reportFilename(report: SimulationReport): string {
  const date = new Date().toISOString().slice(0, 10);
  return `system-design-report-${report.outcome}-${date}.pdf`;
}

function listSection(
  doc: jsPDF,
  y: number,
  title: string,
  items: { label: string }[],
  empty: string
): number {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(title, 14, y);
  y += 6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  if (items.length === 0) {
    doc.setTextColor(100, 116, 139);
    doc.text(empty, 14, y);
    doc.setTextColor(0, 0, 0);
    return y + 8;
  }

  for (const item of items) {
    doc.text(`• ${item.label}`, 16, y);
    y += 5;
  }
  return y + 4;
}

function ensureSpace(doc: jsPDF, y: number, needed: number): number {
  const pageHeight = doc.internal.pageSize.getHeight();
  if (y + needed > pageHeight - 14) {
    doc.addPage();
    return 18;
  }
  return y;
}

export function downloadReportPdf(report: SimulationReport): void {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const won = report.outcome === 'won';

  // Header
  doc.setFillColor(won ? 34 : 248, won ? 197 : 113, won ? 94 : 113);
  doc.rect(0, 0, 210, 28, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('BreakIT — Run Report', 14, 14);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text(
    `${SCENARIO.title} · ${report.duration.toFixed(1)}s · ${won ? 'Survived' : 'Failed'}`,
    14,
    21
  );

  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(28);
  doc.text(String(report.score), 165, 16);
  doc.setFontSize(12);
  doc.text(`Grade ${report.grade}`, 155, 22);

  let y = 38;

  // Summary stats
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Summary', 14, y);
  y += 8;

  const summaryRows = [
    ['Total cost', formatCost(report.totalCost)],
    ['Wasted cost', formatCost(report.wastedCost)],
    ['Success rate', `${report.successRate}%`],
    ['Availability', `${report.availabilityPct}%`],
    ['Peak RPS', String(report.peakRps)],
    ['Traffic spikes', String(report.spikeEvents)],
    ['Requests spawned', report.totalSpawned.toLocaleString()],
    ['Requests completed', report.totalCompleted.toLocaleString()],
    ['Requests dropped', report.totalDropped.toLocaleString()],
  ];

  autoTable(doc, {
    startY: y,
    head: [['Metric', 'Value']],
    body: summaryRows,
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 2.5 },
    headStyles: { fillColor: [30, 41, 59] },
    margin: { left: 14, right: 14 },
  });

  y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;

  // Component table
  y = ensureSpace(doc, y, 40);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Component breakdown', 14, y);
  y += 4;

  autoTable(doc, {
    startY: y,
    head: [
      [
        'Component',
        'Peak util.',
        'Avg util.',
        'Peak queue',
        'Downtime',
        'Overload',
        'Idle',
        'Processed',
        'Cost',
      ],
    ],
    body: report.components.map((c) => [
      c.label,
      `${Math.round(c.maxLoad)}%`,
      `${Math.round(c.avgLoad)}%`,
      `${Math.round(c.maxQueueFill)}%`,
      formatSeconds(c.downtimeSeconds),
      formatSeconds(c.overloadSeconds),
      formatSeconds(c.idleSeconds),
      c.processed.toLocaleString(),
      formatCost(c.monthlyCost),
    ]),
    theme: 'striped',
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [14, 165, 233] },
    margin: { left: 14, right: 14 },
  });

  y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;

  // Insight sections
  y = ensureSpace(doc, y, 30);
  y = listSection(
    doc,
    y,
    'Broken services',
    report.brokenServices,
    'No failures — all services stayed healthy.'
  );
  y = ensureSpace(doc, y, 30);
  y = listSection(
    doc,
    y,
    'Scaled services (high load)',
    report.scaledServices,
    'No component sustained critical load.'
  );
  y = ensureSpace(doc, y, 30);
  y = listSection(
    doc,
    y,
    'Wasted resources',
    report.wastedResources,
    'No obviously idle or duplicate resources detected.'
  );

  if (report.missingComponents.length > 0) {
    y = ensureSpace(doc, y, 20);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(185, 28, 28);
    doc.text('Missing required components', 14, y);
    y += 6;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(report.missingComponents.join(', '), 14, y);
    doc.setTextColor(0, 0, 0);
    y += 10;
  }

  // Load profile
  y = ensureSpace(doc, y, 20);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Utilization profile (peak)', 14, y);
  y += 4;

  autoTable(doc, {
    startY: y,
    head: [['Component', 'Peak utilization']],
    body: report.components.map((c) => [
      c.label,
      `${Math.round(c.maxLoad)}%`,
    ]),
    theme: 'plain',
    styles: { fontSize: 9 },
    margin: { left: 14, right: 14 },
  });

  y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;

  // Recommendations
  y = ensureSpace(doc, y, 20);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Recommendations', 14, y);
  y += 7;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);

  for (const tip of report.recommendations) {
    y = ensureSpace(doc, y, 12);
    const lines = doc.splitTextToSize(`• ${tip}`, 182);
    doc.text(lines, 14, y);
    y += lines.length * 5 + 2;
  }

  // Footer on each page
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `BreakIT · ${SCENARIO.title} · Page ${i} of ${pageCount}`,
      14,
      doc.internal.pageSize.getHeight() - 8
    );
  }

  doc.save(reportFilename(report));
}
