import { Injectable } from '@nestjs/common';
import { DeviceProtocol } from '../entities/device.entity';
import { GT06Processor } from './gt06.processor';
import { TK103Processor } from './tk103.processor';
import { TeltonikaProcessor } from './teltonika.processor';
import { ProtocolProcessor } from './protocol.interface';

@Injectable()
export class ProtocolFactory {
  constructor(
    private readonly gt06: GT06Processor,
    private readonly tk103: TK103Processor,
    private readonly teltonika: TeltonikaProcessor,
  ) {}

  get(protocol: DeviceProtocol): ProtocolProcessor {
    switch (protocol) {
      case DeviceProtocol.GT06:
        return this.gt06;
      case DeviceProtocol.TK103:
        return this.tk103;
      case DeviceProtocol.TELTONIKA:
        return this.teltonika;
      default:
        throw new Error(`No processor registered for protocol "${protocol}"`);
    }
  }
}
