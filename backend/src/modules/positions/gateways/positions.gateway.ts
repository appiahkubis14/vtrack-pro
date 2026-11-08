import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { ClientEvents, ServerEvents } from '../../../common/constants/websocket-events.constant';
import { PositionsService } from '../positions.service';

@WebSocketGateway({ namespace: 'positions', cors: { origin: '*' } })
export class PositionsGateway {
  constructor(private readonly positionsService: PositionsService) {}

  @SubscribeMessage(ClientEvents.REQUEST_LATEST)
  async requestLatest(@ConnectedSocket() client: Socket, @MessageBody() deviceId: string) {
    const position = await this.positionsService.latest(deviceId);
    client.emit(ServerEvents.POSITION_UPDATE, { deviceId, position });
  }

  @SubscribeMessage(ClientEvents.REQUEST_HISTORY)
  async requestHistory(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { deviceId: string; from: string; to: string },
  ) {
    const rows = await this.positionsService.history(
      body.deviceId,
      new Date(body.from),
      new Date(body.to),
    );
    client.emit(ServerEvents.POSITION_BATCH, { deviceId: body.deviceId, positions: rows });
  }
}
