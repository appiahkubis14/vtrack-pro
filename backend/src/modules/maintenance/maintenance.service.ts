import { Injectable, NotImplementedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
// import { Repository } from 'typeorm';
// import { MaintenanceEntity } from './entities/maintenance.entity';

@Injectable()
export class MaintenanceService {
  // constructor(
  //   @InjectRepository(MaintenanceEntity)
  //   private readonly repo: Repository<MaintenanceEntity>,
  // ) {}

  // TODO: replace with a real TypeORM repository call.
  async findAll(query?: any) {
    throw new NotImplementedException('MaintenanceService.findAll is not implemented yet');
  }

  // TODO: replace with a real TypeORM repository call.
  async create(body?: any) {
    throw new NotImplementedException('MaintenanceService.create is not implemented yet');
  }

  // TODO: replace with a real TypeORM repository call.
  async findOne(id: string) {
    throw new NotImplementedException('MaintenanceService.findOne is not implemented yet');
  }

  // TODO: replace with a real TypeORM repository call.
  async update(id: string, body?: any) {
    throw new NotImplementedException('MaintenanceService.update is not implemented yet');
  }

  // TODO: replace with a real TypeORM repository call.
  async remove(id: string) {
    throw new NotImplementedException('MaintenanceService.remove is not implemented yet');
  }

  // TODO: replace with a real TypeORM repository call.
  async schedule(query?: any) {
    throw new NotImplementedException('MaintenanceService.schedule is not implemented yet');
  }

  // TODO: replace with a real TypeORM repository call.
  async overdue(query?: any) {
    throw new NotImplementedException('MaintenanceService.overdue is not implemented yet');
  }
}
