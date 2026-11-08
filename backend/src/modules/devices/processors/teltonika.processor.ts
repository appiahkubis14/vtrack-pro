import { Injectable, Logger } from '@nestjs/common';
import { ParsedPosition, ProtocolProcessor } from './protocol.interface';

/**
 * Teltonika devices (FMB/FMC series) speak the binary Codec 8 / Codec 8
 * Extended protocol over TCP, with a distinct two-phase handshake:
 *   1. Device connects and sends its 15-byte IMEI (length-prefixed, no codec framing).
 *   2. Server ACKs with 0x01 to accept.
 *   3. Device then streams AVL data records (preamble + data length + codec id +
 *      record count + records... + CRC16).
 *
 * Not implemented yet - Codec 8 Extended's IO element parsing (1/2/4/8-byte
 * typed key-value blocks) is substantial enough to warrant its own file
 * (teltonika-codec8.ts) plus device-side test fixtures. Wire it up the same
 * way GT06Processor is wired in protocol.factory.ts once it's built.
 *
 * Reference: Teltonika Codec 8 protocol documentation (per-model PDF on
 * wiki.teltonika-gps.com).
 */
@Injectable()
export class TeltonikaProcessor implements ProtocolProcessor {
  readonly name = 'teltonika';
  private readonly logger = new Logger(TeltonikaProcessor.name);

  parse(buffer: Buffer): ParsedPosition[] {
    this.logger.warn(
      `Received ${buffer.length} bytes on the Teltonika port but Codec 8 parsing is not implemented yet.`,
    );
    return [];
  }
}
