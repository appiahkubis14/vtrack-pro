import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FleetGraphService } from './fleet-graph.service';

@ApiTags('Fleet Graph')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('vehicles/:id')
export class FleetGraphController {
  constructor(private readonly graphService: FleetGraphService) {}

  @Get('asset-chain')
  @ApiOperation({ summary: 'Vehicle -> trailer -> asset chain, per docs/v2-architecture.md section 9' })
  async assetChain(@Param('id') id: string) {
    const graph = await this.graphService.buildForVehicle(id);
    return graph.assetChain(id);
  }
}
