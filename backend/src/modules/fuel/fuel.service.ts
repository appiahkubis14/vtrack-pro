import { Injectable, NotImplementedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
// import { Repository } from 'typeorm';
// import { FuelEntity } from './entities/fuel.entity';

@Injectable()
export class FuelService {
  // constructor(
  //   @InjectRepository(FuelEntity)
  //   private readonly repo: Repository<FuelEntity>,
  // ) {}

  // TODO: replace with a real TypeORM repository call.
  async consumptionOverview(query?: any) {
    throw new NotImplementedException('FuelService.consumptionOverview is not implemented yet');
  }

  // TODO: replace with a real TypeORM repository call.
  async consumptionByDevice(deviceId: string) {
    throw new NotImplementedException('FuelService.consumptionByDevice is not implemented yet');
  }

  // TODO: replace with a real TypeORM repository call.
  async levelByDevice(deviceId: string) {
    throw new NotImplementedException('FuelService.levelByDevice is not implemented yet');
  }

  // TODO: replace with a real TypeORM repository call.
  async theftEvents(deviceId: string) {
    throw new NotImplementedException('FuelService.theftEvents is not implemented yet');
  }

  // TODO: replace with a real TypeORM repository call.
  async refuelingEvents(deviceId: string) {
    throw new NotImplementedException('FuelService.refuelingEvents is not implemented yet');
  }

  // TODO: replace with a real TypeORM repository call.
  async reports(query?: any) {
    throw new NotImplementedException('FuelService.reports is not implemented yet');
  }

  // TODO: replace with a real TypeORM repository call.
  async calibrateSensor(body?: any) {
    throw new NotImplementedException('FuelService.calibrateSensor is not implemented yet');
  }
}
