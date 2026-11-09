import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { SimulationReport } from './types';
import { formatCost, formatSeconds } from './report';
import { getActiveScenario } from './scenario-runtime';

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

/**
 * Optional record sections (interview-platform.md §4.5): the host's notes,
 * the scenario as applied, and the board. With these the PDF is the whole
 * interview record, and it lives only on the host's machine.
 */
export interface ReportPdfExtras {
  notes?: string;
  scenario?: unknown;
  board?: {
    components: { label: string; type: string }[];
    beltCount: number;
    textCount: number;
    strokeCount: number;
  };
  roomCode?: string | null;
}

export function downloadReportPdf(report: SimulationReport, extras: ReportPdfExtras = {}): void {
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
    `${getActiveScenario().title} · ${report.duration.toFixed(1)}s · ${won ? 'Survived' : 'Failed'}`,
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
    ['Flow violations', report.totalViolated.toLocaleString()],
    // Reproducibility (interview-platform.md §8): the same board and seed replay this run.
    ['Traffic seed', String(report.seed)],
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

  if (report.objectives.length > 0) {
    y = ensureSpace(doc, y, 30);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Objectives', 14, y);
    y += 4;

    autoTable(doc, {
      startY: y,
      head: [['Objective', 'Target', 'Measured', 'Result']],
      body: report.objectives.map((objective) => [
        objective.label,
        objective.target,
        objective.actual,
        objective.met ? 'Met' : 'Missed',
      ]),
      theme: 'grid',
      styles: { fontSize: 9, cellPadding: 2.5 },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
  }

  if (report.flowStats.length > 0) {
    y = ensureSpace(doc, y, 30);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Request flows', 14, y);
    y += 4;

    autoTable(doc, {
      startY: y,
      head: [['Kind', 'Spawned', 'Completed', 'Dropped', 'Violated', 'Completion']],
      body: report.flowStats.map((stat) => [
        stat.kind,
        stat.spawned.toLocaleString(),
        stat.completed.toLocaleString(),
        stat.dropped.toLocaleString(),
        stat.violated.toLocaleString(),
        `${stat.completionRate}%`,
      ]),
      theme: 'grid',
      styles: { fontSize: 9, cellPadding: 2.5 },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
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

  // Record sections (§4.5)
  if (extras.board) {
    y = ensureSpace(doc, y, 30);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(30, 30, 30);
    doc.text('Board as run', 14, y);
    y += 4;
    autoTable(doc, {
      startY: y,
      head: [['Component', 'Type']],
      body: extras.board.components.map((c) => [c.label, c.type]),
      styles: { fontSize: 9 },
      theme: 'grid',
    });
    y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(
      `${extras.board.beltCount} connections · ${extras.board.textCount} notes on the board · ${extras.board.strokeCount} drawings · seed ${report.seed}${extras.roomCode ? ` · room ${extras.roomCode}` : ''}`,
      14,
      y
    );
    y += 8;
  }

  if (extras.scenario !== undefined) {
    y = ensureSpace(doc, y, 30);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(30, 30, 30);
    doc.text('Scenario as applied', 14, y);
    y += 6;
    doc.setFont('courier', 'normal');
    doc.setFontSize(7);
    const json = JSON.stringify(extras.scenario, null, 2);
    for (const line of json.split('\n').slice(0, 400)) {
      y = ensureSpace(doc, y, 4);
      doc.text(line.length > 110 ? `${line.slice(0, 107)}…` : line, 14, y);
      y += 3.2;
    }
    y += 6;
  }

  if (extras.notes !== undefined && extras.notes.trim() !== '') {
    y = ensureSpace(doc, y, 30);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(30, 30, 30);
    doc.text('Host notes', 14, y);
    y += 7;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    for (const paragraph of extras.notes.split(/\n/)) {
      const lines = doc.splitTextToSize(paragraph || ' ', 182);
      y = ensureSpace(doc, y, lines.length * 5 + 2);
      doc.text(lines, 14, y);
      y += lines.length * 5 + 1;
    }
  }

  // Footer on each page
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `BreakIT · ${getActiveScenario().title} · Page ${i} of ${pageCount}`,
      14,
      doc.internal.pageSize.getHeight() - 8
    );
  }

  doc.save(reportFilename(report));
}
