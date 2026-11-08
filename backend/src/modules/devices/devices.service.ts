import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Device } from './entities/device.entity';
import { RemoteCommand } from '../commands/entities/remote-command.entity';
import { CreateDeviceDto } from './dto/create-device.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';
import { BulkImportDeviceDto } from './dto/bulk-import-device.dto';
import { SendDeviceCommandDto } from './dto/send-device-command.dto';
import { CommandStatus, DeviceStatus } from '../../common/constants/alerts.constant';
import { DeviceTcpService } from './tcp/device-tcp.service';
import { TenantLimitsService } from '../organizations/tenant-limits.service';

@Injectable()
export class DevicesService {
  constructor(
    @InjectRepository(Device) private readonly devices: Repository<Device>,
    @InjectRepository(RemoteCommand) private readonly commands: Repository<RemoteCommand>,
    private readonly tcpService: DeviceTcpService,
    private readonly tenantLimits: TenantLimitsService,
  ) {}

  findAll(query: { organizationId?: string; status?: DeviceStatus; page?: number; limit?: number } = {}) {
    const { organizationId, status, page = 1, limit = 25 } = query;
    return this.devices.findAndCount({
      where: {
        ...(organizationId ? { organizationId } : {}),
        ...(status ? { status } : {}),
      },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
  }

  async findOne(id: string, organizationId?: string) {
    const device = await this.devices.findOne({ where: { id, ...(organizationId ? { organizationId } : {}) } });
    if (!device) throw new NotFoundException(`Device ${id} not found`);
    return device;
  }

  async create(dto: CreateDeviceDto & { organizationId: string }) {
    await this.tenantLimits.assertCanAddDevice(dto.organizationId);
    return this.devices.save(this.devices.create(dto));
  }

  async update(id: string, dto: UpdateDeviceDto, organizationId: string) {
    await this.findOne(id, organizationId);
    // Whitelist: never let a request move a device to another organisation or change its identity fields blindly.
    const patch: Record<string, unknown> = {};
    for (const k of ['name', 'model', 'simNumber', 'vehicleId', 'protocol', 'config'] as const) if ((dto as any)[k] !== undefined) patch[k] = (dto as any)[k] === '' ? null : (dto as any)[k];
    if (Object.keys(patch).length) await this.devices.update({ id, organizationId }, patch as any);
    return this.findOne(id, organizationId);
  }

  async remove(id: string, organizationId: string) {
    await this.findOne(id, organizationId);
    await this.devices.softDelete(id);
    return { success: true };
  }

  async bulkImport(dto: BulkImportDeviceDto, organizationId: string) {
    const rows = dto.devices.map((d) => this.devices.create({ ...d, organizationId }));
    const saved = await this.devices.save(rows);
    return { imported: saved.length };
  }

  async statistics(organizationId?: string) {
    const qb = this.devices.createQueryBuilder('d');
    if (organizationId) qb.where('d.organization_id = :organizationId', { organizationId });

    const [total, online, offline] = await Promise.all([
      qb.clone().getCount(),
      qb.clone().andWhere('d.status != :offline', { offline: DeviceStatus.OFFLINE }).getCount(),
      qb.clone().andWhere('d.status = :offline', { offline: DeviceStatus.OFFLINE }).getCount(),
    ]);

    return { total, online, offline };
  }

  async sendCommand(deviceId: string, userId: string, dto: SendDeviceCommandDto, organizationId?: string) {
    const device = await this.findOne(deviceId, organizationId);

    const command = await this.commands.save(
      this.commands.create({
        organizationId: device.organizationId,
        deviceId,
        userId,
        command: dto.command,
        parameters: dto.parameters,
        scheduledFor: dto.scheduledFor ? new Date(dto.scheduledFor) : undefined,
        status: dto.scheduledFor ? CommandStatus.PENDING : CommandStatus.PENDING,
      }),
    );

    if (!dto.scheduledFor) {
      // Fire immediately if the device has a live TCP connection; otherwise it
      // stays PENDING and command-scheduler.ts / command-queue.processor.ts
      // (BullMQ) pick it up on the device's next check-in.
      const delivered = this.tcpService.trySendCommand(device.imei, dto.command, dto.parameters);
      await this.commands.update(command.id, {
        status: delivered ? CommandStatus.SENT : CommandStatus.PENDING,
        sentAt: delivered ? new Date() : undefined,
      });
    }

    return this.commands.findOne({ where: { id: command.id } });
  }

  listCommands(deviceId: string, organizationId?: string) {
    return this.commands.find({ where: { deviceId, ...(organizationId ? { organizationId } : {}) }, order: { createdAt: 'DESC' } });
  }

  async updateConfig(id: string, config: Record<string, unknown>, organizationId: string) {
    await this.findOne(id, organizationId);
    return this.devices.update({ id, organizationId }, { config } as any);
  }
}
