import { Injectable, Logger } from '@nestjs/common';
import { ParsedPosition, ProtocolProcessor } from './protocol.interface';

/**
 * TK103 ASCII protocol.
 *
 * TK103 clones from different factories disagree on field layout more than
 * any other tracker family. This parser handles the common comma-delimited
 * dialect:
 *
 *   (IMEI,BR00,YYMMDDHHMMSS,A/V,DDMM.MMMM,N/S,DDDMM.MMMM,E/W,speedKnots,course,...)
 *
 * Confirm your specific device's field order against its datasheet before
 * trusting this against real hardware - if your units use fixed-width
 * (no commas) framing instead, swap parseCommaDelimited() for a slice-based
 * reader keyed off your datasheet's byte offsets.
 */
@Injectable()
export class TK103Processor implements ProtocolProcessor {
  readonly name = 'tk103';
  private readonly logger = new Logger(TK103Processor.name);

  parse(buffer: Buffer): ParsedPosition[] {
    const text = buffer.toString('ascii').trim();
    const inner = text.replace(/^\(/, '').replace(/\)$/, '');

    if (!inner.includes(',')) {
      this.logger.debug('Non comma-delimited TK103 frame received - see class docblock');
      return [];
    }

    const fields = inner.split(',');
    const [imei, packetType, dateTime, valid, lat, latHem, lon, lonHem, speedKnotsStr, courseStr] = fields;

    if (packetType && !packetType.startsWith('BR') && !packetType.startsWith('BP')) {
      // Login / heartbeat / command-ack packet, not a location fix.
      return [];
    }
    if (valid !== 'A') return []; // 'V' = no GPS fix yet

    const latitude = this.toDecimalDegrees(lat, latHem);
    const longitude = this.toDecimalDegrees(lon, lonHem);
    const speed = (parseFloat(speedKnotsStr) || 0) * 1.852; // knots -> km/h

    return [
      {
        deviceIdentifier: imei,
        latitude,
        longitude,
        speed,
        heading: parseFloat(courseStr) || undefined,
        timestamp: this.parseDateTime(dateTime),
        eventType: 'location',
      },
    ];
  }

  private toDecimalDegrees(raw: string, hemisphere: string): number {
    // Format: DDMM.MMMM (lat) or DDDMM.MMMM (lon)
    const dotIndex = raw.indexOf('.');
    const degreesLength = dotIndex - 2;
    const degrees = parseFloat(raw.slice(0, degreesLength));
    const minutes = parseFloat(raw.slice(degreesLength));
    const value = degrees + minutes / 60;
    return hemisphere === 'S' || hemisphere === 'W' ? -value : value;
  }

  private parseDateTime(raw: string): Date {
    if (!raw || raw.length < 12) return new Date();
    const year = 2000 + parseInt(raw.slice(0, 2), 10);
    const month = parseInt(raw.slice(2, 4), 10) - 1;
    const day = parseInt(raw.slice(4, 6), 10);
    const hour = parseInt(raw.slice(6, 8), 10);
    const minute = parseInt(raw.slice(8, 10), 10);
    const second = parseInt(raw.slice(10, 12), 10);
    return new Date(Date.UTC(year, month, day, hour, minute, second));
  }
}
