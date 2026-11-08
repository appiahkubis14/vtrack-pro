export interface ParsedPosition {
  /** Raw device identifier as sent on the wire (IMEI for most protocols). */
  deviceIdentifier: string;
  latitude: number;
  longitude: number;
  speed?: number;
  heading?: number;
  altitude?: number;
  ignition?: boolean;
  fuelLevel?: number;
  battery?: number;
  gsmSignal?: number;
  satellites?: number;
  eventType?: string;
  /** CAN bus / OBD readings when the tracker provides them (see docs/map.md for the key names). */
  obd?: Record<string, unknown>;
  /** Other sensors: temperature, door, etc. */
  sensors?: Record<string, unknown>;
  timestamp: Date;
}

export interface ProtocolProcessor {
  readonly name: string;

  /**
   * Parse one raw TCP frame. A single frame can yield zero positions (e.g. a
   * login/heartbeat packet that only needs an ACK) or more than one for
   * protocols that batch multiple fixes per message.
   */
  parse(buffer: Buffer): ParsedPosition[];

  /** Bytes to write back to the socket to acknowledge the frame, if the protocol requires it. */
  buildAck?(buffer: Buffer): Buffer | null;
}
