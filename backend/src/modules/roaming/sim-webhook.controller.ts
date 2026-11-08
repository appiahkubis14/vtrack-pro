import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SimProfilesService } from './sim-profiles.service';

/**
 * Receives callbacks from an IoT SIM connectivity provider (e.g. a
 * Truphone/1NCE/Africa's Talking-style IoT SIM platform). This is the
 * honest integration point for SIM-swap detection and network/roaming
 * status - standard GT06/TK103 GPS packets don't carry ICCID or network
 * provider data, so that signal has to come from the SIM platform's own
 * API, not from the device's location reports.
 *
 * Not authenticated with the normal JWT guard since the caller is an
 * external system, not a logged-in user - production use needs a shared
 * webhook secret or provider-specific signature verification (added per
 * whichever IoT SIM platform is actually integrated; left as a TODO since
 * the exact scheme is provider-specific).
 */
@ApiTags('Roaming')
@Controller('webhooks/sim-provider')
export class SimWebhookController {
  constructor(private readonly simProfilesService: SimProfilesService) {}

  @Post('iccid-change')
  @ApiOperation({ summary: 'IoT SIM provider callback: a device is now reporting a different ICCID than expected' })
  async iccidChange(@Body() body: { deviceId: string; iccid: string }) {
    // TODO: verify the webhook signature/secret here before trusting the
    // payload - this endpoint is unauthenticated by necessity (external
    // caller) but must not be left open to spoofed swap reports in production.
    await this.simProfilesService.detectSwapFromDevice(body.deviceId, body.iccid);
    return { received: true };
  }

  @Post('network-status')
  @ApiOperation({ summary: 'IoT SIM provider callback: current network/roaming status and data usage for a SIM' })
  async networkStatus(
    @Body() body: { simProfileId: string; country?: string; provider?: string; dataUsedMbDelta?: number },
  ) {
    if (body.dataUsedMbDelta) {
      await this.simProfilesService.recordDataUsage(body.simProfileId, body.dataUsedMbDelta, body.country, body.provider);
    }
    return { received: true };
  }
}
