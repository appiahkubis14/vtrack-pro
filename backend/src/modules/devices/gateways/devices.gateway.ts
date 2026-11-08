import { UseGuards } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { WebsocketAuthGuard } from '../../../common/guards/websocket-auth.guard';
import { ClientEvents, ServerEvents } from '../../../common/constants/websocket-events.constant';
import { ParsedPosition } from '../processors/protocol.interface';

/**
 * Namespace for browser/dashboard clients (as opposed to the raw TCP servers
 * that speak GT06/TK103/etc to physical trackers - see tcp-server.service.ts).
 *
 * In production, swap the default in-memory adapter for @socket.io/redis-adapter
 * (see services/redis.service.ts) so this scales across multiple app instances.
 */
@WebSocketGateway({ namespace: 'devices', cors: { origin: '*' } })
export class DevicesGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  handleConnection(client: Socket) {
    client.emit(ServerEvents.CONNECTION_STATUS, { status: 'connected', socketId: client.id });
  }

  handleDisconnect(client: Socket) {
    void client;
  }

  @UseGuards(WebsocketAuthGuard)
  @SubscribeMessage(ClientEvents.JOIN_DEVICE)
  joinDevice(@ConnectedSocket() client: Socket, @MessageBody() deviceId: string) {
    client.join(`device:${deviceId}`);
    return { event: 'joined', deviceId };
  }

  @SubscribeMessage(ClientEvents.LEAVE_DEVICE)
  leaveDevice(@ConnectedSocket() client: Socket, @MessageBody() deviceId: string) {
    client.leave(`device:${deviceId}`);
    return { event: 'left', deviceId };
  }

  /** Called by DevicesService whenever a new position lands, not a direct client handler. */
  broadcastPosition(deviceId: string, position: ParsedPosition) {
    this.server.to(`device:${deviceId}`).emit(ServerEvents.POSITION_UPDATE, { deviceId, position });
  }

  broadcastDeviceStatus(deviceId: string, status: string) {
    this.server.to(`device:${deviceId}`).emit(ServerEvents.DEVICE_STATUS, { deviceId, status });
  }
}
