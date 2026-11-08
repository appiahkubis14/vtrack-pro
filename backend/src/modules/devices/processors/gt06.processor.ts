import { Injectable, Logger } from '@nestjs/common';
import { ParsedPosition, ProtocolProcessor } from './protocol.interface';

/**
 * GT06 (and GT06N/GT03 family) binary protocol.
 *
 * Frame: 0x78 0x78 | length(1) | protocol#(1) | content(N) | serial(2) | crc16(2) | 0x0D 0x0A
 *
 * This covers the two packet types you need to get a device online and
 * flowing positions: login (0x01) and GPS location (0x12/0x22). Alarm
 * packets, LBS-only fixes, and the various vendor sub-variants are not
 * decoded here - check your device's protocol PDF and extend `parse()`
 * before relying on this against real hardware.
 */
@Injectable()
export class GT06Processor implements ProtocolProcessor {
  readonly name = 'gt06';
  private readonly logger = new Logger(GT06Processor.name);

  private static readonly HEADER = 0x7878;
  private static readonly PROTOCOL_LOGIN = 0x01;
  private static readonly PROTOCOL_LOCATION = 0x12;
  private static readonly PROTOCOL_LOCATION_LBS = 0x22;
  private static readonly PROTOCOL_HEARTBEAT = 0x13;

  parse(buffer: Buffer): ParsedPosition[] {
    if (buffer.length < 5 || buffer.readUInt16BE(0) !== GT06Processor.HEADER) {
      throw new Error('Invalid GT06 frame header');
    }

    const length = buffer.readUInt8(2);
    const protocol = buffer.readUInt8(3);
    const frameEnd = 3 + length; // covers content + serial(2) + crc(2)

    if (frameEnd + 2 > buffer.length) {
      throw new Error('Truncated GT06 frame');
    }

    const crcReceived = buffer.readUInt16BE(frameEnd - 2);
    const crcComputed = GT06Processor.crc16Itu(buffer.subarray(2, frameEnd - 2));
    if (crcReceived !== crcComputed) {
      throw new Error('GT06 CRC mismatch');
    }

    const content = buffer.subarray(4, frameEnd - 4);

    switch (protocol) {
      case GT06Processor.PROTOCOL_LOGIN: {
        const terminalId = GT06Processor.decodeBcdTerminalId(content);
        this.logger.debug(`Login packet, terminal id: ${terminalId}`);
        // Not a real position - flagged eventType 'login' so DeviceTcpService
        // can use it purely to associate this socket with a device, without
        // writing a bogus (0,0) row into positions.
        return [
          {
            deviceIdentifier: terminalId,
            latitude: 0,
            longitude: 0,
            eventType: 'login',
            timestamp: new Date(),
          },
        ];
      }
      case GT06Processor.PROTOCOL_HEARTBEAT:
        return [];
      case GT06Processor.PROTOCOL_LOCATION:
      case GT06Processor.PROTOCOL_LOCATION_LBS: {
        const fix = this.parseLocation(content);
        // 0x22 packets carry LBS data (8 bytes) and then the ACC (engine on) flag, after the 18 bytes parsed above.
        if (protocol === GT06Processor.PROTOCOL_LOCATION_LBS && content.length >= 27) fix.ignition = content.readUInt8(26) === 1;
        return [fix];
      }
      default:
        this.logger.debug(`Unhandled GT06 protocol number 0x${protocol.toString(16)}`);
        return [];
    }
  }

  /**
   * GT06 login packets carry the terminal ID as 8 BCD-packed bytes (16 hex
   * nibbles). Real-world devices sometimes encode a 15-digit IMEI here with
   * one padding nibble (convention varies by vendor - often a leading 0);
   * DeviceTcpService tries both the full 16-digit decode and a
   * leading-nibble-stripped 15-digit version against the devices table to
   * accommodate that.
   */
  private static decodeBcdTerminalId(content: Buffer): string {
    let id = '';
    for (let i = 0; i < Math.min(content.length, 8); i++) {
      id += content[i].toString(16).padStart(2, '0');
    }
    return id;
  }

  buildAck(buffer: Buffer): Buffer | null {
    if (buffer.readUInt16BE(0) !== GT06Processor.HEADER) return null;
    const protocol = buffer.readUInt8(3);
    const length = buffer.readUInt8(2);
    // Serial number is the two bytes immediately before the CRC.
    const serial = buffer.subarray(3 + length - 4, 3 + length - 2);

    const body = Buffer.concat([Buffer.from([0x05, protocol]), serial]);
    const crc = GT06Processor.crc16Itu(body);
    return Buffer.concat([
      Buffer.from([0x78, 0x78]),
      body,
      Buffer.from([crc >> 8, crc & 0xff]),
      Buffer.from([0x0d, 0x0a]),
    ]);
  }

  private parseLocation(content: Buffer): ParsedPosition {
    let offset = 0;
    const year = content.readUInt8(offset++);
    const month = content.readUInt8(offset++);
    const day = content.readUInt8(offset++);
    const hour = content.readUInt8(offset++);
    const minute = content.readUInt8(offset++);
    const second = content.readUInt8(offset++);
    const timestamp = new Date(Date.UTC(2000 + year, month - 1, day, hour, minute, second));

    const gpsInfo = content.readUInt8(offset++);
    const satellites = gpsInfo & 0x0f;

    const rawLat = content.readUInt32BE(offset);
    offset += 4;
    const rawLon = content.readUInt32BE(offset);
    offset += 4;
    const speed = content.readUInt8(offset++);
    const courseStatus = content.readUInt16BE(offset);
    offset += 2;

    const latitude = rawLat / 30000 / 60;
    const longitude = rawLon / 30000 / 60;
    const isSouth = !((courseStatus >> 10) & 0x01);
    const isWest = !((courseStatus >> 11) & 0x01);
    const heading = courseStatus & 0x03ff;

    return {
      deviceIdentifier: '', // resolved by the caller from the login session / TCP connection map
      latitude: isSouth ? -latitude : latitude,
      longitude: isWest ? -longitude : longitude,
      speed,
      heading,
      satellites,
      ignition: undefined,
      timestamp,
      eventType: 'location',
    };
  }

  private static crc16Itu(buf: Buffer): number {
    let crc = 0xffff;
    for (const byte of buf) {
      crc ^= byte;
      for (let i = 0; i < 8; i++) {
        crc = crc & 0x0001 ? (crc >> 1) ^ 0x8408 : crc >> 1;
      }
    }
    return (~crc) & 0xffff;
  }
}
