import { Injectable, NotImplementedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
// import { Repository } from 'typeorm';
// import { DriverEntity } from './entities/drivers.entity';

@Injectable()
export class DriversService {
  // constructor(
  //   @InjectRepository(DriverEntity)
  //   private readonly repo: Repository<DriverEntity>,
  // ) {}

  // TODO: replace with a real TypeORM repository call.
  async findAll(query?: any) {
    throw new NotImplementedException('DriversService.findAll is not implemented yet');
  }

  // TODO: replace with a real TypeORM repository call.
  async create(body?: any) {
    throw new NotImplementedException('DriversService.create is not implemented yet');
  }

  // TODO: replace with a real TypeORM repository call.
  async findOne(id: string) {
    throw new NotImplementedException('DriversService.findOne is not implemented yet');
  }

  // TODO: replace with a real TypeORM repository call.
  async update(id: string, body?: any) {
    throw new NotImplementedException('DriversService.update is not implemented yet');
  }

  // TODO: replace with a real TypeORM repository call.
  async remove(id: string) {
    throw new NotImplementedException('DriversService.remove is not implemented yet');
  }

  // TODO: replace with a real TypeORM repository call.
  async score(id: string) {
    throw new NotImplementedException('DriversService.score is not implemented yet');
  }

  // TODO: replace with a real TypeORM repository call.
  async trips(id: string) {
    throw new NotImplementedException('DriversService.trips is not implemented yet');
  }

  // TODO: replace with a real TypeORM repository call.
  async assign(id: string, body?: any) {
    throw new NotImplementedException('DriversService.assign is not implemented yet');
  }

  // TODO: replace with a real TypeORM repository call.
  async unassign(id: string, body?: any) {
    throw new NotImplementedException('DriversService.unassign is not implemented yet');
  }

  // TODO: replace with a real TypeORM repository call.
  async leaderboard(query?: any) {
    throw new NotImplementedException('DriversService.leaderboard is not implemented yet');
  }
}
