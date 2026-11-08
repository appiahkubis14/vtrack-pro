import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Vehicle } from '../vehicles/entities/vehicle.entity';
import { VehicleDevice } from './entities/vehicle-device.entity';
import { Device } from '../devices/entities/device.entity';
import { FleetGraph } from './graph/fleet-graph.engine';

@Injectable()
export class FleetGraphService {
  constructor(
    @InjectRepository(Vehicle) private readonly vehicles: Repository<Vehicle>,
    @InjectRepository(VehicleDevice) private readonly vehicleDevices: Repository<VehicleDevice>,
    @InjectRepository(Device) private readonly devices: Repository<Device>,
  ) {}

  /**
   * Builds a small FleetGraph covering one vehicle's organization + devices.
   * Trailer/Asset nodes are not modeled in the relational schema yet (no
   * `trailers`/`assets` tables exist) - assetChain() queries against a graph
   * built here will correctly return no trailer/assets until that schema
   * gap is closed, rather than silently fabricating data.
   */
  async buildForVehicle(vehicleId: string): Promise<FleetGraph> {
    const graph = new FleetGraph();
    const vehicle = await this.vehicles.findOne({ where: { id: vehicleId } });
    if (!vehicle) return graph;

    graph.addNode({ id: vehicle.organizationId, label: 'Organization', properties: {} });
    graph.addNode({ id: vehicle.id, label: 'Vehicle', properties: { plate: vehicle.plateNumber } });
    graph.addEdge({ from: vehicle.organizationId, to: vehicle.id, type: 'OWNS' });

    const links = await this.vehicleDevices.find({ where: { vehicleId, isActive: true } });
    for (const link of links) {
      const device = await this.devices.findOne({ where: { id: link.deviceId } });
      if (!device) continue;
      graph.addNode({ id: device.id, label: 'Device', properties: { imei: device.imei, role: link.role } });
      graph.addEdge({ from: device.id, to: vehicle.id, type: 'HAS_DEVICE' });
    }

    return graph;
  }
}
