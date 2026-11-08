import * as net from 'net';
import { forwardRef, Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Device, DeviceProtocol } from '../entities/device.entity';
import { RawDeviceData } from '../entities/raw-device-data.entity';
import { ProtocolFactory } from '../processors/protocol.factory';
import { ParsedPosition } from '../processors/protocol.interface';
import { DeviceStatus } from '../../../common/constants/alerts.constant';

interface ManagedServer {
  protocol: DeviceProtocol;
  port: number;
  server: net.Server;
}

/**
 * One TCP listener per GPS protocol. Each device connects, we identify it by
 * IMEI (parsed out of its login/first packet), then keep the socket around in
 * `connectionsByImei` so DevicesService.sendCommand() can push bytes straight
 * down the wire for protocols that support server-initiated commands.
 *
 * This does NOT touch PositionsService directly to avoid a devices <-> positions
 * circular module dependency - instead it emits onFix(), which DevicesModule's
 * consumer (wired in devices.module.ts) forwards to PositionsService.ingest().
 */
@Injectable()
export class DeviceTcpService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeviceTcpService.name);
  private readonly servers: ManagedServer[] = [];
  private readonly connectionsByImei = new Map<string, net.Socket>();
  private readonly imeiBySocket = new WeakMap<net.Socket, string>();
  private readonly deviceIdByImei = new Map<string, string>();

  /** Set by PositionsService after it wires itself in - see positions.service.ts onModuleInit(). */
  onFix: (deviceImei: string, position: ParsedPosition) => void = () => {};

  constructor(
    private readonly config: ConfigService,
    private readonly protocolFactory: ProtocolFactory,
    @InjectRepository(Device) private readonly devices: Repository<Device>,
    @InjectRepository(RawDeviceData) private readonly rawData: Repository<RawDeviceData>,
  ) {}

  onModuleInit() {
    this.startServer(DeviceProtocol.GT06, this.config.get<number>('GT06_PORT') ?? 5023);
    this.startServer(DeviceProtocol.TK103, this.config.get<number>('TK103_PORT') ?? 5040);
    this.startServer(DeviceProtocol.TELTONIKA, this.config.get<number>('TELTONIKA_PORT') ?? 5050);
  }

  onModuleDestroy() {
    for (const { server, port } of this.servers) {
      server.close();
      this.logger.log(`Closed listener on port ${port}`);
    }
  }

  private startServer(protocol: DeviceProtocol, port: number) {
    const processor = this.protocolFactory.get(protocol);

    const server = net.createServer((socket) => {
      this.logger.log(`[${protocol}] connection from ${socket.remoteAddress}:${socket.remotePort}`);

      socket.on('data', async (buffer) => {
        try {
          const positions = processor.parse(buffer);
          const known = this.imeiBySocket.get(socket);

          // A 'login' event only identifies the device - it must never be
          // ingested as a position (its lat/lng are meaningless placeholders).
          const loginEvent = positions.find((p) => p.eventType === 'login');
          const dataEvents = positions.filter((p) => p.eventType !== 'login');

          let identifiedImei = known;

          if (loginEvent && !known) {
            identifiedImei = (await this.resolveImei(loginEvent.deviceIdentifier)) ?? undefined;
            if (identifiedImei) {
              this.imeiBySocket.set(socket, identifiedImei);
              this.connectionsByImei.set(identifiedImei, socket);
              await this.devices.update(
                { imei: identifiedImei },
                { status: DeviceStatus.IDLE, lastCommunicationAt: new Date() },
              );
              this.logger.log(`[${protocol}] socket identified as device ${identifiedImei}`);
            } else {
              this.logger.warn(
                `[${protocol}] login from unregistered terminal id ${loginEvent.deviceIdentifier} - no matching device.imei`,
              );
            }
          } else if (!known && dataEvents[0]?.deviceIdentifier) {
            // Protocols (e.g. TK103) that carry the identifier on every packet
            // rather than a separate login step.
            identifiedImei = (await this.resolveImei(dataEvents[0].deviceIdentifier)) ?? undefined;
            if (identifiedImei) {
              this.imeiBySocket.set(socket, identifiedImei);
              this.connectionsByImei.set(identifiedImei, socket);
            }
          }

          if (identifiedImei) {
            const deviceUuid =
              this.deviceIdByImei.get(identifiedImei) ??
              (await this.devices.findOne({ where: { imei: identifiedImei } }))?.id;

            if (deviceUuid) {
              this.deviceIdByImei.set(identifiedImei, deviceUuid);
              this.rawData
                .save(
                  this.rawData.create({
                    deviceId: deviceUuid,
                    protocol,
                    rawHex: buffer.toString('hex'),
                    ipAddress: socket.remoteAddress,
                    port,
                  }),
                )
                .catch((err) => this.logger.warn(`[${protocol}] failed to save raw frame: ${err.message}`));
            }

            for (const position of dataEvents) {
              this.onFix(identifiedImei, { ...position, deviceIdentifier: identifiedImei });
            }
          }

          const ack = processor.buildAck?.(buffer);
          if (ack) socket.write(ack);
        } catch (err) {
          this.logger.warn(`[${protocol}] failed to parse frame: ${(err as Error).message}`);
        }
      });

      socket.on('close', () => {
        const imei = this.imeiBySocket.get(socket);
        if (imei) {
          this.connectionsByImei.delete(imei);
          this.devices
            .update({ imei }, { status: DeviceStatus.OFFLINE })
            .catch((err) => this.logger.warn(`Failed to mark ${imei} offline: ${err.message}`));
        }
      });

      socket.on('error', (err) => this.logger.warn(`[${protocol}] socket error: ${err.message}`));
    });

    server.listen(port, () => this.logger.log(`[${protocol}] listening on TCP ${port}`));
    this.servers.push({ protocol, port, server });
  }

  /**
   * Matches a wire-format terminal ID against devices.imei, trying the
   * conventions real GT06 clones actually use: exact match, then a single
   * leading or trailing hex nibble stripped off (vendors disagree on which
   * side the padding nibble goes when packing a 15-digit IMEI into 16 BCD
   * nibbles). Returns the canonical DB imei (not the raw wire string) so
   * everything downstream keys off one consistent value.
   */
  private async resolveImei(rawTerminalId: string): Promise<string | null> {
    const candidates = [rawTerminalId, rawTerminalId.slice(1), rawTerminalId.slice(0, -1)];
    for (const candidate of candidates) {
      const device = await this.devices.findOne({ where: { imei: candidate } });
      if (device) {
        this.deviceIdByImei.set(device.imei, device.id);
        return device.imei;
      }
    }
    return null;
  }

  /** Returns true if the command bytes were written to a live socket, false if the device isn't connected. */
  trySendCommand(imei: string, command: string, parameters?: Record<string, unknown>): boolean {
    const socket = this.connectionsByImei.get(imei);
    if (!socket) return false;

    // TODO: encode `command`/`parameters` into the protocol-specific command
    // frame for whichever protocol this device speaks (GT06 command packets,
    // TK103 AT-style strings, etc.) - this just demonstrates the wiring.
    this.logger.log(`Would send "${command}" ${JSON.stringify(parameters ?? {})} to ${imei}`);
    return true;
  }
}
