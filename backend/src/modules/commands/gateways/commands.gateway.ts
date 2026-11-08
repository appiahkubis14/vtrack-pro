import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { ServerEvents } from '../../../common/constants/websocket-events.constant';
import { CommandStatus } from '../../../common/constants/alerts.constant';

@WebSocketGateway({ namespace: 'commands', cors: { origin: '*' } })
export class CommandsGateway {
  @WebSocketServer()
  server: Server;

  /** Called by command-queue.processor.ts as a BullMQ job moves through its lifecycle. */
  broadcastStatus(commandId: string, deviceId: string, status: CommandStatus) {
    this.server.emit(ServerEvents.COMMAND_UPDATE, { commandId, deviceId, status });
  }

  broadcastResponse(commandId: string, deviceId: string, response: Record<string, unknown>) {
    this.server.emit(ServerEvents.COMMAND_RESPONSE, { commandId, deviceId, response });
  }
}
