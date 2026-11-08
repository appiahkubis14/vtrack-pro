import { Injectable } from '@nestjs/common';
import { ExcelGenerator } from './excel.generator';
import { PdfGenerator } from './pdf.generator';

export type ReportFormat = 'pdf' | 'excel' | 'csv' | 'json';

export interface ReportSpec {
  type: 'fuel' | 'trip' | 'driver' | 'maintenance' | 'geofence';
  format: ReportFormat;
  title: string;
  columns: { header: string; key: string }[];
  rows: Record<string, unknown>[];
}

/**
 * Dispatches to the right generator by format. The `rows`/`columns` here are
 * expected to already be assembled by the relevant module's query (e.g.
 * FuelService.reports() for type: 'fuel') - this class only handles output
 * formatting, not data assembly.
 */
@Injectable()
export class ReportBuilder {
  constructor(
    private readonly excel: ExcelGenerator,
    private readonly pdf: PdfGenerator,
  ) {}

  async build(spec: ReportSpec): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
    switch (spec.format) {
      case 'excel': {
        const buffer = await this.excel.generate(spec.title, spec.columns, spec.rows);
        return {
          buffer,
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          filename: `${spec.type}-report.xlsx`,
        };
      }
      case 'pdf': {
        const lines = spec.rows.map((row) => spec.columns.map((c) => `${c.header}: ${row[c.key]}`).join('  |  '));
        const buffer = await this.pdf.generate(spec.title, lines);
        return { buffer, contentType: 'application/pdf', filename: `${spec.type}-report.pdf` };
      }
      case 'csv': {
        const header = spec.columns.map((c) => c.header).join(',');
        const csvRows = spec.rows.map((row) => spec.columns.map((c) => JSON.stringify(row[c.key] ?? '')).join(','));
        const buffer = Buffer.from([header, ...csvRows].join('\n'));
        return { buffer, contentType: 'text/csv', filename: `${spec.type}-report.csv` };
      }
      default: {
        const buffer = Buffer.from(JSON.stringify(spec.rows, null, 2));
        return { buffer, contentType: 'application/json', filename: `${spec.type}-report.json` };
      }
    }
  }
}
