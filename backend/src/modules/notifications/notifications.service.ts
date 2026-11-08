import { Injectable, NotImplementedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
// import { Repository } from 'typeorm';
// import { NotificationEntity } from './entities/notifications.entity';

@Injectable()
export class NotificationsService {
  // constructor(
  //   @InjectRepository(NotificationEntity)
  //   private readonly repo: Repository<NotificationEntity>,
  // ) {}

  // TODO: replace with a real TypeORM repository call.
  async findAll(query?: any) {
    throw new NotImplementedException('NotificationsService.findAll is not implemented yet');
  }

  // TODO: replace with a real TypeORM repository call.
  async findOne(id: string) {
    throw new NotImplementedException('NotificationsService.findOne is not implemented yet');
  }

  // TODO: replace with a real TypeORM repository call.
  async markRead(id: string, body?: any) {
    throw new NotImplementedException('NotificationsService.markRead is not implemented yet');
  }

  // TODO: replace with a real TypeORM repository call.
  async updatePreferences(body?: any) {
    throw new NotImplementedException('NotificationsService.updatePreferences is not implemented yet');
  }

  // TODO: replace with a real TypeORM repository call.
  async getPreferences(query?: any) {
    throw new NotImplementedException('NotificationsService.getPreferences is not implemented yet');
  }
}
