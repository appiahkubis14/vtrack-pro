import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SavedReport } from './entities/saved-report.entity';
import { ReportExecution } from './entities/report-execution.entity';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ExcelGenerator } from './generators/excel.generator';
import { PdfGenerator } from './generators/pdf.generator';
import { ReportBuilder } from './generators/report-builder';

@Module({
  imports: [TypeOrmModule.forFeature([SavedReport, ReportExecution])],
  controllers: [ReportsController],
  providers: [ReportsService, ExcelGenerator, PdfGenerator, ReportBuilder],
  exports: [ReportsService],
})
export class ReportsModule {}
