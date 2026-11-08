import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { DigitalTwinState } from './digital-twin-state.interface';
import { MapScopeService } from '../map/map-scope.service';

@WebSocketGateway({ namespace: 'twin', cors: { origin: '*' } })
export class DigitalTwinGateway implements OnGatewayConnection {
  @WebSocketServer()
  server: Server;

  constructor(private readonly jwt: JwtService, private readonly scope: MapScopeService) {}

  /**
   * Only signed-in users may connect. The room is chosen from the token, never from anything the client sends:
   * users who see everything join the organization room, users limited to certain hubs join only those hubs' rooms.
   */
  async handleConnection(client: Socket) {
    try {
      const token = (client.handshake?.auth as any)?.token ?? client.handshake?.headers?.authorization?.split(' ')[1];
      const user = this.jwt.verify(token);
      if (!user?.organizationId) throw new Error('no organization');
      client.data.user = user;
      await this.joinRooms(client);
      client.emit('connectionStatus', { status: 'connected', socketId: client.id });
    } catch {
      client.emit('connectionStatus', { status: 'unauthorized' });
      client.disconnect(true);
    }
  }

  private async joinRooms(client: Socket) {
    const u = client.data.user; const s = await this.scope.hubScope({ sub: u.sub, role: u.role, organizationId: u.organizationId } as any);
    if (s.all) client.join(`org:${u.organizationId}`);
    else s.hubIds.forEach((h) => client.join(`org:${u.organizationId}:hub:${h}`));
  }

  /** Sends an update only to the people who may see this vehicle, and never while the vehicle is off duty (driver privacy). */
  private async emitFor(organizationId: string, vehicleId: string, event: string, payload: unknown, isPosition = false) {
    if (isPosition && (await this.scope.isOffDuty(organizationId, vehicleId))) return;
    const hub = await this.scope.hubOfVehicle(organizationId, vehicleId);
    let t = this.server.to(`org:${organizationId}`);
    if (hub) t = t.to(`org:${organizationId}:hub:${hub}`);
    t.emit(event, payload);
  }

  /**
   * Clients must join their organization's room before they'll receive any
   * broadcastUpdate/broadcastDeviceOnline/etc. calls below - Socket.IO rooms
   * are opt-in per connection, there's no automatic subscription just from
   * being connected to the namespace.
   */
  @SubscribeMessage('joinOrg')
  async joinOrg(@ConnectedSocket() client: Socket, @MessageBody() _ignored: string) {
    const organizationId = client.data?.user?.organizationId;
    if (!organizationId) return { event: 'error', message: 'unauthorized' };
    await this.joinRooms(client); // already joined on connect; kept so older pages keep working
    return { event: 'joinedOrg', organizationId };
  }

  @SubscribeMessage('leaveOrg')
  leaveOrg(@ConnectedSocket() client: Socket, @MessageBody() _ignored: string) {
    const organizationId = client.data?.user?.organizationId;
    if (organizationId) [...client.rooms].filter((r) => r.startsWith(`org:${organizationId}`)).forEach((r) => client.leave(r));
    return { event: 'leftOrg', organizationId };
  }

  broadcastUpdate(state: DigitalTwinState) {
    this.emitFor(state.organizationId, state.vehicleId, 'digitalTwinUpdate', state, true).catch(() => undefined);
    if (state.ev) this.emitFor(state.organizationId, state.vehicleId, 'evBatteryUpdate', { vehicleId: state.vehicleId, ev: state.ev }, true).catch(() => undefined);
  }

  broadcastDeviceOnline(vehicleId: string, organizationId: string, deviceId: string) {
    this.emitFor(organizationId, vehicleId, 'deviceOnline', { vehicleId, deviceId }).catch(() => undefined);
  }

  broadcastDeviceOffline(vehicleId: string, organizationId: string, deviceId: string) {
    this.emitFor(organizationId, vehicleId, 'deviceOffline', { vehicleId, deviceId }).catch(() => undefined);
  }

  broadcastDeviceConflict(vehicleId: string, organizationId: string, field: string, candidates: unknown[]) {
    this.emitFor(organizationId, vehicleId, 'deviceConflictDetected', { vehicleId, field, candidates }).catch(() => undefined);
  }
}
