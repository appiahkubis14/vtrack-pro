import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ServerEvents } from '../../common/constants/websocket-events.constant';

@WebSocketGateway({ namespace: 'v2-events', cors: { origin: '*' } })
export class RealtimeEventsGateway implements OnGatewayConnection {
  @WebSocketServer()
  server: Server;

  handleConnection(client: Socket) {
    client.emit('connectionStatus', { status: 'connected', socketId: client.id });
  }

  @SubscribeMessage('joinOrg')
  joinOrg(@ConnectedSocket() client: Socket, @MessageBody() organizationId: string) {
    client.join(`org:${organizationId}`);
    return { event: 'joinedOrg', organizationId };
  }

  @SubscribeMessage('leaveOrg')
  leaveOrg(@ConnectedSocket() client: Socket, @MessageBody() organizationId: string) {
    client.leave(`org:${organizationId}`);
    return { event: 'leftOrg', organizationId };
  }

  emit(organizationId: string, event: (typeof ServerEvents)[keyof typeof ServerEvents], payload: unknown) {
    this.server.to(`org:${organizationId}`).emit(event, payload);
  }
}
