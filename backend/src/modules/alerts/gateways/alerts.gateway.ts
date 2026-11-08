import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ServerEvents } from '../../../common/constants/websocket-events.constant';
import { Alert } from '../entities/alert.entity';

@WebSocketGateway({ namespace: 'alerts', cors: { origin: '*' } })
export class AlertsGateway implements OnGatewayConnection {
  @WebSocketServer()
  server: Server;

  constructor(private readonly jwt: JwtService) {}

  /** Signed-in users are placed in their own organization's room; nobody can ask for another one. */
  handleConnection(client: Socket) {
    try {
      const token = (client.handshake?.auth as any)?.token ?? client.handshake?.headers?.authorization?.split(' ')[1];
      const user = this.jwt.verify(token);
      if (!user?.organizationId) throw new Error('no organization');
      client.data.user = user;
      client.join(`org:${user.organizationId}`);
    } catch {
      client.disconnect(true);
    }
  }

  broadcastNewAlert(alert: Alert) {
    this.server.to(`org:${alert.organizationId}`).emit(ServerEvents.NEW_ALERT, alert);
  }

  broadcastUpdate(alert: Alert) {
    this.server.to(`org:${alert.organizationId}`).emit(ServerEvents.ALERT_UPDATE, alert);
  }
}
