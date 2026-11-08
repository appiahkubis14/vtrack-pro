import { Injectable, NotImplementedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
// import { Repository } from 'typeorm';
// import { ReportEntity } from './entities/reports.entity';

@Injectable()
export class ReportsService {
  // constructor(
  //   @InjectRepository(ReportEntity)
  //   private readonly repo: Repository<ReportEntity>,
  // ) {}

  // TODO: replace with a real TypeORM repository call.
  async generate(body?: any) {
    throw new NotImplementedException('ReportsService.generate is not implemented yet');
  }

  // TODO: replace with a real TypeORM repository call.
  async findOne(id: string) {
    throw new NotImplementedException('ReportsService.findOne is not implemented yet');
  }

  // TODO: replace with a real TypeORM repository call.
  async download(id: string) {
    throw new NotImplementedException('ReportsService.download is not implemented yet');
  }

  // TODO: replace with a real TypeORM repository call.
  async schedule(body?: any) {
    throw new NotImplementedException('ReportsService.schedule is not implemented yet');
  }

  // TODO: replace with a real TypeORM repository call.
  async listScheduled(query?: any) {
    throw new NotImplementedException('ReportsService.listScheduled is not implemented yet');
  }

  // TODO: replace with a real TypeORM repository call.
  async removeScheduled(id: string) {
    throw new NotImplementedException('ReportsService.removeScheduled is not implemented yet');
  }
}
