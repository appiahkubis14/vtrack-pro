import { Injectable, NotImplementedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
// import { Repository } from 'typeorm';
// import { TripEntity } from './entities/trips.entity';

@Injectable()
export class TripsService {
  // constructor(
  //   @InjectRepository(TripEntity)
  //   private readonly repo: Repository<TripEntity>,
  // ) {}

  // TODO: replace with a real TypeORM repository call.
  async findAll(query?: any) {
    throw new NotImplementedException('TripsService.findAll is not implemented yet');
  }

  // TODO: replace with a real TypeORM repository call.
  async findOne(id: string) {
    throw new NotImplementedException('TripsService.findOne is not implemented yet');
  }

  // TODO: replace with a real TypeORM repository call.
  async byDevice(deviceId: string) {
    throw new NotImplementedException('TripsService.byDevice is not implemented yet');
  }

  // TODO: replace with a real TypeORM repository call.
  async byDriver(driverId: string) {
    throw new NotImplementedException('TripsService.byDriver is not implemented yet');
  }

  // TODO: replace with a real TypeORM repository call.
  async route(id: string) {
    throw new NotImplementedException('TripsService.route is not implemented yet');
  }

  // TODO: replace with a real TypeORM repository call.
  async analyze(body?: any) {
    throw new NotImplementedException('TripsService.analyze is not implemented yet');
  }

  // TODO: replace with a real TypeORM repository call.
  async summary(query?: any) {
    throw new NotImplementedException('TripsService.summary is not implemented yet');
  }
}
