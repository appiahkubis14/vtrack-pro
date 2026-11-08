import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Headers, Param, ParseUUIDPipe, Post, Put, Query, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { timingSafeEqual } from 'crypto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { currentUser } from '../../common/auth/auth-user';
import { Role } from '../../common/constants/roles.constant';
import { MAP_READ } from './map.controller';
import { AdvancedService } from './advanced.service';
import { DispatchService } from './dispatch.service';
import { TasksService } from './tasks.service';
import { PositionsService } from '../positions/positions.service';

const FIELD: Role[] = [Role.RIDER, Role.DRIVER];

@ApiTags('Map (advanced)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('map')
export class MapAdvancedController {
  constructor(private readonly adv: AdvancedService, private readonly dispatch: DispatchService, private readonly tasks: TasksService) {}
  private u(req: Request) { return currentUser(req); }

  // vehicle groups and geofence rules
  @Get('groups') @Roles(...MAP_READ) groups(@Req() r: Request) { return this.adv.groups(this.u(r)); }
  @Post('groups') @Roles(...MAP_READ) createGroup(@Body() b: any, @Req() r: Request) { return this.adv.createGroup(this.u(r), b); }
  @Put('groups/:id') @Roles(...MAP_READ) updateGroup(@Param('id', ParseUUIDPipe) id: string, @Body() b: any, @Req() r: Request) { return this.adv.updateGroup(this.u(r), id, b); }
  @Delete('groups/:id') @Roles(...MAP_READ) removeGroup(@Param('id', ParseUUIDPipe) id: string, @Req() r: Request) { return this.adv.removeGroup(this.u(r), id); }
  @Put('groups/:id/members') @Roles(...MAP_READ) members(@Param('id', ParseUUIDPipe) id: string, @Body() b: any, @Req() r: Request) { return this.adv.setMembers(this.u(r), id, b?.vehicleIds); }
  @Put('geofences/:id/groups') @Roles(...MAP_READ) geofenceGroups(@Param('id', ParseUUIDPipe) id: string, @Body() b: any, @Req() r: Request) { return this.adv.setGeofenceGroups(this.u(r), id, b?.groupIds); }
  @Post('geofences/import') @Roles(...MAP_READ) importGeofences(@Body() b: any, @Req() r: Request) { return this.adv.importGeofences(this.u(r), b); }

  // who sees what
  @Get('scope/me') @Roles(...MAP_READ) myScope(@Req() r: Request) { return this.adv.myScope(this.u(r)); }
  @Get('scope/users/:id') @Roles(...MAP_READ) getScope(@Param('id', ParseUUIDPipe) id: string, @Req() r: Request) { return this.adv.getScope(this.u(r), id); }
  @Put('scope/users/:id') @Roles(...MAP_READ) setScope(@Param('id', ParseUUIDPipe) id: string, @Body() b: any, @Req() r: Request) { return this.adv.setScope(this.u(r), id, b?.hubIds); }

  // driver privacy
  @Get('privacy') @Roles(...MAP_READ) privacy(@Req() r: Request) { return this.adv.privacyList(this.u(r)); }
  @Put('vehicles/:id/privacy') @Roles(...MAP_READ) setPrivacy(@Param('id', ParseUUIDPipe) id: string, @Body() b: any, @Req() r: Request) { return this.adv.setPrivacy(this.u(r), id, b); }
  @Delete('vehicles/:id/privacy') @Roles(...MAP_READ) removePrivacy(@Param('id', ParseUUIDPipe) id: string, @Req() r: Request) { return this.adv.removePrivacy(this.u(r), id); }

  // dashcam links
  @Get('vehicles/:id/camera') @Roles(...MAP_READ) camera(@Param('id', ParseUUIDPipe) id: string, @Req() r: Request) { return this.adv.camera(this.u(r), id); }
  @Put('vehicles/:id/camera') @Roles(...MAP_READ) setCamera(@Param('id', ParseUUIDPipe) id: string, @Body() b: any, @Req() r: Request) { return this.adv.setCamera(this.u(r), id, b); }
  @Delete('vehicles/:id/camera') @Roles(...MAP_READ) removeCamera(@Param('id', ParseUUIDPipe) id: string, @Req() r: Request) { return this.adv.removeCamera(this.u(r), id); }

  // charging availability and sensor assets
  @Put('pois/:id/availability') @Roles(...MAP_READ) availability(@Param('id', ParseUUIDPipe) id: string, @Body() b: any, @Req() r: Request) { return this.adv.setAvailability(this.u(r), id, b); }
  @Get('assets') @Roles(...MAP_READ) assets(@Req() r: Request) { return this.adv.assets(this.u(r)); }
  @Post('assets') @Roles(...MAP_READ) createAsset(@Body() b: any, @Req() r: Request) { return this.adv.createAsset(this.u(r), b); }
  @Put('assets/:id') @Roles(...MAP_READ) updateAsset(@Param('id', ParseUUIDPipe) id: string, @Body() b: any, @Req() r: Request) { return this.adv.updateAsset(this.u(r), id, b); }
  @Delete('assets/:id') @Roles(...MAP_READ) removeAsset(@Param('id', ParseUUIDPipe) id: string, @Req() r: Request) { return this.adv.removeAsset(this.u(r), id); }

  // risk, dispatch and route advice
  @Get('risk') @Roles(...MAP_READ) risk(@Req() r: Request) { return this.adv.risk(this.u(r)); }
  @Get('risk/areas') @Roles(...MAP_READ) riskAreas(@Query() q: any, @Req() r: Request) { return this.adv.riskAreas(this.u(r), q); }
  @Get('dispatch') @Roles(...MAP_READ) board(@Req() r: Request) { return this.dispatch.board(this.u(r)); }
  /** Re-checks ETA, route and arrival for one vehicle right now instead of waiting for the next minute. */
  @Post('dispatch/check') @Roles(...MAP_READ)
  async checkNow(@Body() b: any, @Req() r: Request) { const u = this.u(r); const id = String(b?.vehicleId ?? ''); if (!/^[0-9a-f-]{36}$/i.test(id)) throw new BadRequestException('vehicleId is required'); await this.adv.assertCanDispatch(u, id); await this.dispatch.checkNow(u.organizationId, id); return { checked: true }; }
  @Get('route-advice') @Roles(...MAP_READ)
  advice(@Query() q: any, @Req() r: Request) {
    const pr = ['time', 'energy', 'balanced'].includes(q.priority) ? q.priority : 'balanced';
    return this.dispatch.advice(this.u(r), String(q.vehicleId ?? ''), { lat: Number(q.toLat), lng: Number(q.toLng) }, pr, q.dueAt ? String(q.dueAt) : null);
  }

  // zone checklists
  @Get('tasks/definitions') @Roles(...MAP_READ) defs(@Req() r: Request) { return this.tasks.listDefinitions(this.u(r)); }
  @Post('tasks/definitions') @Roles(...MAP_READ) createDef(@Body() b: any, @Req() r: Request) { return this.tasks.createDefinition(this.u(r), b); }
  @Put('tasks/definitions/:id') @Roles(...MAP_READ) updateDef(@Param('id', ParseUUIDPipe) id: string, @Body() b: any, @Req() r: Request) { return this.tasks.updateDefinition(this.u(r), id, b); }
  @Delete('tasks/definitions/:id') @Roles(...MAP_READ) removeDef(@Param('id', ParseUUIDPipe) id: string, @Req() r: Request) { return this.tasks.removeDefinition(this.u(r), id); }
  @Get('tasks') @Roles(...MAP_READ) runs(@Query() q: any, @Req() r: Request) { return this.tasks.listRuns(this.u(r), q); }
  @Get('tasks/:id/photo') @Roles(...MAP_READ) photo(@Param('id', ParseUUIDPipe) id: string, @Req() r: Request) { return this.tasks.photo(this.u(r), id); }
  @Get('my-tasks') @Roles(...FIELD) mine(@Req() r: Request) { return this.tasks.myRuns(this.u(r)); }
  @Post('task-runs/:id/complete') @Roles(...MAP_READ, ...FIELD) complete(@Param('id', ParseUUIDPipe) id: string, @Body() b: any, @Req() r: Request) { return this.tasks.complete(this.u(r), id, b); }
}

/** Entry for hardware gateways (CAN/OBD trackers, sensor trackers, camera boxes). Protected by TELEMETRY_INGEST_KEY, not by a user login. */
@ApiTags('Map ingest')
@Controller('map/ingest')
export class TelemetryIngestController {
  constructor(private readonly adv: AdvancedService, private readonly positions: PositionsService) {}

  private auth(key?: string) {
    const want = process.env.TELEMETRY_INGEST_KEY;
    if (!want || want.length < 16) throw new ForbiddenException('Telemetry ingestion is not enabled (set TELEMETRY_INGEST_KEY, at least 16 characters)');
    const a = Buffer.from(String(key ?? '')), b = Buffer.from(want);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException('Invalid ingest key');
  }
  private plain(o: any, what: string) {
    if (o === undefined || o === null) return undefined;
    if (typeof o !== 'object' || Array.isArray(o) || Object.keys(o).length > 40) throw new BadRequestException(`${what} must be an object with at most 40 keys`);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) {
      if (!/^[A-Za-z0-9_]{1,40}$/.test(k)) throw new BadRequestException(`${what}: key "${k.slice(0, 20)}" is not allowed`);
      if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
      else if (typeof v === 'string') out[k] = v.slice(0, 120);
      else if (Array.isArray(v) && v.length <= 30 && v.every((x) => typeof x === 'string' || typeof x === 'number')) out[k] = v.map((x) => (typeof x === 'string' ? x.slice(0, 20) : x));
      else throw new BadRequestException(`${what}: value of "${k}" must be a number, text, true/false or a short list`);
    }
    return out;
  }

  @Post('telemetry') @Throttle({ default: { limit: 600, ttl: 60_000 } })
  async telemetry(@Headers('x-ingest-key') key: string, @Body() b: any) {
    this.auth(key);
    const imei = String(b?.imei ?? ''); if (!/^[0-9A-Za-z]{6,20}$/.test(imei)) throw new BadRequestException('imei is required');
    const lat = Number(b?.latitude), lng = Number(b?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new BadRequestException('latitude and longitude are required');
    const ts = b?.timestamp ? new Date(b.timestamp) : new Date();
    if (isNaN(+ts) || +ts > Date.now() + 5 * 60_000) throw new BadRequestException('timestamp must be a valid time, not in the future');
    const speed = b?.speed === undefined ? undefined : Number(b.speed), heading = b?.heading === undefined ? undefined : Number(b.heading);
    if ((speed !== undefined && (!Number.isFinite(speed) || speed < 0 || speed > 400)) || (heading !== undefined && (!Number.isFinite(heading) || heading < 0 || heading > 360))) throw new BadRequestException('speed or heading is out of range');
    const saved = await this.positions.ingestFromImei(imei, { deviceIdentifier: imei, latitude: lat, longitude: lng, speed, heading, ignition: b?.ignition === undefined ? undefined : !!b.ignition, battery: b?.battery === undefined ? undefined : Number(b.battery), fuelLevel: b?.fuelLevel === undefined ? undefined : Number(b.fuelLevel), timestamp: ts, obd: this.plain(b?.obd, 'obd'), sensors: this.plain(b?.sensors, 'sensors') });
    if (!saved) throw new BadRequestException('Unknown device: register the IMEI first');
    return { accepted: true };
  }

  @Post('assets/:id') @Throttle({ default: { limit: 600, ttl: 60_000 } })
  async asset(@Headers('x-ingest-key') key: string, @Param('id', ParseUUIDPipe) id: string, @Body() b: any) { this.auth(key); return this.adv.reportAsset(id, b); }
}
