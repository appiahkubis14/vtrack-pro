#!/usr/bin/env node
/**
 * Scaffolds module/controller/service files for the "plain CRUD-ish" feature modules
 * (the ones that don't need a bespoke gateway or protocol processor - those are
 * hand-written: auth, devices, positions, commands gateway, alerts gateway).
 *
 * Usage: node tools/generate-modules.js
 *
 * Re-run any time to add a new module to MODULES below - it will not overwrite
 * files that already have real business logic unless you pass --force.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src', 'modules');
const FORCE = process.argv.includes('--force');

const pascal = (s) => s.replace(/(^|-)(\w)/g, (_, __, c) => c.toUpperCase());
const camel = (s) => {
  const p = pascal(s);
  return p.charAt(0).toLowerCase() + p.slice(1);
};

const MODULES = [
  {
    dir: 'organizations',
    name: 'Organizations',
    tag: 'Organizations',
    routes: [
      { method: 'Get', path: '', handler: 'findAll', summary: 'List organizations' },
      { method: 'Post', path: '', handler: 'create', summary: 'Create an organization' },
      { method: 'Get', path: ':id', handler: 'findOne', summary: 'Get an organization' },
      { method: 'Put', path: ':id', handler: 'update', summary: 'Update an organization' },
      { method: 'Delete', path: ':id', handler: 'remove', summary: 'Delete an organization' },
      { method: 'Get', path: ':id/users', handler: 'listUsers', summary: 'List users in an organization' },
      { method: 'Post', path: ':id/users/invite', handler: 'inviteUser', summary: 'Invite a user' },
    ],
  },
  {
    dir: 'vehicles',
    name: 'Vehicles',
    tag: 'Vehicles',
    routes: [
      { method: 'Get', path: '', handler: 'findAll', summary: 'List vehicles' },
      { method: 'Post', path: '', handler: 'create', summary: 'Register a vehicle' },
      { method: 'Get', path: ':id', handler: 'findOne', summary: 'Get a vehicle' },
      { method: 'Put', path: ':id', handler: 'update', summary: 'Update a vehicle' },
      { method: 'Delete', path: ':id', handler: 'remove', summary: 'Delete a vehicle' },
      { method: 'Get', path: ':id/maintenance', handler: 'listMaintenance', summary: 'Maintenance history' },
      { method: 'Post', path: ':id/maintenance', handler: 'scheduleMaintenance', summary: 'Schedule maintenance' },
    ],
  },
  {
    dir: 'fuel',
    name: 'Fuel',
    tag: 'Fuel',
    routes: [
      { method: 'Get', path: 'consumption', handler: 'consumptionOverview', summary: 'Fleet-wide consumption' },
      { method: 'Get', path: ':deviceId/consumption', handler: 'consumptionByDevice', summary: 'Consumption for a device' },
      { method: 'Get', path: ':deviceId/level', handler: 'levelByDevice', summary: 'Current fuel level' },
      { method: 'Get', path: ':deviceId/theft-detection', handler: 'theftEvents', summary: 'Fuel theft events' },
      { method: 'Get', path: ':deviceId/refueling', handler: 'refuelingEvents', summary: 'Refueling events' },
      { method: 'Get', path: 'reports', handler: 'reports', summary: 'Fuel reports' },
      { method: 'Post', path: 'sensor/calibrate', handler: 'calibrateSensor', summary: 'Calibrate a fuel sensor' },
    ],
  },
  {
    dir: 'geofences',
    name: 'Geofences',
    tag: 'Geofences',
    routes: [
      { method: 'Get', path: '', handler: 'findAll', summary: 'List geofences' },
      { method: 'Post', path: '', handler: 'create', summary: 'Create a geofence' },
      { method: 'Get', path: ':id', handler: 'findOne', summary: 'Get a geofence' },
      { method: 'Put', path: ':id', handler: 'update', summary: 'Update a geofence' },
      { method: 'Delete', path: ':id', handler: 'remove', summary: 'Delete a geofence' },
      { method: 'Post', path: ':id/test', handler: 'test', summary: 'Test a point against a geofence' },
      { method: 'Get', path: ':id/events', handler: 'events', summary: 'Entry/exit events' },
      { method: 'Get', path: 'active', handler: 'active', summary: 'Currently active geofences' },
    ],
  },
  {
    dir: 'alerts',
    name: 'Alerts',
    tag: 'Alerts',
    routes: [
      { method: 'Get', path: '', handler: 'findAll', summary: 'List alerts' },
      { method: 'Get', path: ':id', handler: 'findOne', summary: 'Get an alert' },
      { method: 'Put', path: ':id/acknowledge', handler: 'acknowledge', summary: 'Acknowledge an alert' },
      { method: 'Put', path: ':id/resolve', handler: 'resolve', summary: 'Resolve an alert' },
      { method: 'Post', path: 'rules', handler: 'createRule', summary: 'Create an alert rule' },
      { method: 'Get', path: 'rules', handler: 'listRules', summary: 'List alert rules' },
      { method: 'Get', path: 'statistics', handler: 'statistics', summary: 'Alert statistics' },
    ],
  },
  {
    dir: 'notifications',
    name: 'Notifications',
    tag: 'Notifications',
    routes: [
      { method: 'Get', path: '', handler: 'findAll', summary: 'List notifications' },
      { method: 'Get', path: ':id', handler: 'findOne', summary: 'Get a notification' },
      { method: 'Put', path: ':id/read', handler: 'markRead', summary: 'Mark as read' },
      { method: 'Post', path: 'preferences', handler: 'updatePreferences', summary: 'Update channel preferences' },
      { method: 'Get', path: 'preferences', handler: 'getPreferences', summary: 'Get channel preferences' },
    ],
  },
  {
    dir: 'trips',
    name: 'Trips',
    tag: 'Trips',
    routes: [
      { method: 'Get', path: '', handler: 'findAll', summary: 'List trips' },
      { method: 'Get', path: ':id', handler: 'findOne', summary: 'Get a trip' },
      { method: 'Get', path: 'device/:deviceId', handler: 'byDevice', summary: 'Trips for a device' },
      { method: 'Get', path: 'driver/:driverId', handler: 'byDriver', summary: 'Trips for a driver' },
      { method: 'Get', path: ':id/route', handler: 'route', summary: 'Trip route geometry for playback' },
      { method: 'Post', path: 'analyze', handler: 'analyze', summary: 'Trigger trip analysis' },
      { method: 'Get', path: 'summary', handler: 'summary', summary: 'Trip summary report' },
    ],
  },
  {
    dir: 'drivers',
    name: 'Drivers',
    tag: 'Drivers',
    routes: [
      { method: 'Get', path: '', handler: 'findAll', summary: 'List drivers' },
      { method: 'Post', path: '', handler: 'create', summary: 'Create a driver' },
      { method: 'Get', path: ':id', handler: 'findOne', summary: 'Get a driver' },
      { method: 'Put', path: ':id', handler: 'update', summary: 'Update a driver' },
      { method: 'Delete', path: ':id', handler: 'remove', summary: 'Delete a driver' },
      { method: 'Get', path: ':id/score', handler: 'score', summary: 'Driver behavior score' },
      { method: 'Get', path: ':id/trips', handler: 'trips', summary: "Driver's trips" },
      { method: 'Post', path: ':id/assign', handler: 'assign', summary: 'Assign to a vehicle' },
      { method: 'Post', path: ':id/unassign', handler: 'unassign', summary: 'Unassign from a vehicle' },
      { method: 'Get', path: 'leaderboard', handler: 'leaderboard', summary: 'Driver leaderboard' },
    ],
  },
  {
    dir: 'maintenance',
    name: 'Maintenance',
    tag: 'Maintenance',
    routes: [
      { method: 'Get', path: '', handler: 'findAll', summary: 'List maintenance records' },
      { method: 'Post', path: '', handler: 'create', summary: 'Create a maintenance record' },
      { method: 'Get', path: ':id', handler: 'findOne', summary: 'Get a maintenance record' },
      { method: 'Put', path: ':id', handler: 'update', summary: 'Update a maintenance record' },
      { method: 'Delete', path: ':id', handler: 'remove', summary: 'Delete a maintenance record' },
      { method: 'Get', path: 'schedule', handler: 'schedule', summary: 'Upcoming schedule' },
      { method: 'Get', path: 'overdue', handler: 'overdue', summary: 'Overdue maintenance' },
    ],
  },
  {
    dir: 'reports',
    name: 'Reports',
    tag: 'Reports',
    routes: [
      { method: 'Post', path: 'generate', handler: 'generate', summary: 'Generate a report' },
      { method: 'Get', path: ':id', handler: 'findOne', summary: 'Get report metadata' },
      { method: 'Get', path: 'download/:id', handler: 'download', summary: 'Download a generated report' },
      { method: 'Post', path: 'schedule', handler: 'schedule', summary: 'Schedule a recurring report' },
      { method: 'Get', path: 'scheduled', handler: 'listScheduled', summary: 'List scheduled reports' },
      { method: 'Delete', path: 'scheduled/:id', handler: 'removeScheduled', summary: 'Cancel a scheduled report' },
    ],
  },
  {
    dir: 'analytics',
    name: 'Analytics',
    tag: 'Analytics',
    routes: [
      { method: 'Get', path: 'predictive-maintenance', handler: 'predictiveMaintenance', summary: 'Predicted maintenance needs' },
      { method: 'Get', path: 'driver-risk', handler: 'driverRisk', summary: 'Driver risk assessment' },
      { method: 'Get', path: 'fuel-forecast', handler: 'fuelForecast', summary: 'Fuel consumption forecast' },
      { method: 'Get', path: 'anomalies', handler: 'anomalies', summary: 'Detected anomalies' },
    ],
  },
  {
    dir: 'dashboard',
    name: 'Dashboard',
    tag: 'Dashboard',
    routes: [
      { method: 'Get', path: 'overview', handler: 'overview', summary: 'Fleet overview KPIs' },
      { method: 'Get', path: 'real-time', handler: 'realTime', summary: 'Real-time snapshot' },
      { method: 'Get', path: 'fuel', handler: 'fuel', summary: 'Fuel KPIs' },
      { method: 'Get', path: 'alerts', handler: 'alerts', summary: 'Alert KPIs' },
      { method: 'Get', path: 'performance', handler: 'performance', summary: 'Fleet performance KPIs' },
      { method: 'Get', path: 'statistics', handler: 'statistics', summary: 'General statistics' },
    ],
  },
  {
    dir: 'audit',
    name: 'Audit',
    tag: 'Audit',
    routes: [
      { method: 'Get', path: 'logs', handler: 'findAll', summary: 'List audit log entries' },
      { method: 'Get', path: 'logs/:id', handler: 'findOne', summary: 'Get an audit log entry' },
    ],
  },
];

function controllerSource(mod) {
  const className = `${mod.name}Controller`;
  const serviceClass = `${mod.name}Service`;
  const serviceVar = camel(mod.name) + 'Service';

  const methodsSrc = mod.routes
    .map((r) => {
      const params = [...r.path.matchAll(/:(\w+)/g)].map((m) => m[1]);
      const paramArgs = params
        .map((p) => `@Param('${p}') ${p}: string`)
        .join(', ');
      const bodyArg = r.method === 'Post' || r.method === 'Put' ? '@Body() body: any' : '';
      const queryArg = r.method === 'Get' && !params.length ? '@Query() query: any' : '';
      const args = [paramArgs, bodyArg, queryArg].filter(Boolean).join(', ');
      const callArgs = [...params, r.method === 'Post' || r.method === 'Put' ? 'body' : null, r.method === 'Get' && !params.length ? 'query' : null]
        .filter(Boolean)
        .join(', ');

      return `  @${r.method}('${r.path}')
  @ApiOperation({ summary: '${r.summary.replace(/'/g, "\\'")}' })
  ${r.handler}(${args}) {
    return this.${serviceVar}.${r.handler}(${callArgs});
  }`;
    })
    .join('\n\n');

  return `import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ${serviceClass} } from './${mod.dir}.service';

@ApiTags('${mod.tag}')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('${mod.dir}')
export class ${className} {
  constructor(private readonly ${serviceVar}: ${serviceClass}) {}

${methodsSrc}
}
`;
}

function serviceSource(mod) {
  const className = `${mod.name}Service`;
  const methodsSrc = mod.routes
    .map((r) => {
      const params = [...r.path.matchAll(/:(\w+)/g)].map((m) => m[1]);
      const args = [
        ...params.map((p) => `${p}: string`),
        r.method === 'Post' || r.method === 'Put' ? 'body?: any' : null,
        r.method === 'Get' && !params.length ? 'query?: any' : null,
      ]
        .filter(Boolean)
        .join(', ');

      return `  // TODO: replace with a real TypeORM repository call.
  async ${r.handler}(${args}) {
    throw new NotImplementedException('${mod.name}Service.${r.handler} is not implemented yet');
  }`;
    })
    .join('\n\n');

  return `import { Injectable, NotImplementedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
// import { Repository } from 'typeorm';
// import { ${mod.name.replace(/s$/, '')}Entity } from './entities/${mod.dir}.entity';

@Injectable()
export class ${className} {
  // constructor(
  //   @InjectRepository(${mod.name.replace(/s$/, '')}Entity)
  //   private readonly repo: Repository<${mod.name.replace(/s$/, '')}Entity>,
  // ) {}

${methodsSrc}
}
`;
}

function moduleSource(mod) {
  const className = `${mod.name}Module`;
  return `import { Module } from '@nestjs/common';
import { ${mod.name}Controller } from './${mod.dir}.controller';
import { ${mod.name}Service } from './${mod.dir}.service';

@Module({
  controllers: [${mod.name}Controller],
  providers: [${mod.name}Service],
  exports: [${mod.name}Service],
})
export class ${className} {}
`;
}

for (const mod of MODULES) {
  // Routes whose first path segment is a literal (e.g. 'active', 'download/:id')
  // must be registered before routes whose first segment is a param (':id'),
  // or the param route shadows them. Stable sort preserves relative order
  // within each category.
  const category = (p) => (p === '' ? 0 : p.startsWith(':') ? 2 : 1);
  mod.routes = mod.routes
    .map((r, i) => ({ r, i }))
    .sort((a, b) => category(a.r.path) - category(b.r.path) || a.i - b.i)
    .map(({ r }) => r);
}

let written = 0;
let skipped = 0;

for (const mod of MODULES) {
  const dir = path.join(SRC, mod.dir);
  fs.mkdirSync(dir, { recursive: true });

  const files = {
    [`${mod.dir}.controller.ts`]: controllerSource(mod),
    [`${mod.dir}.service.ts`]: serviceSource(mod),
    [`${mod.dir}.module.ts`]: moduleSource(mod),
  };

  for (const [filename, content] of Object.entries(files)) {
    const filePath = path.join(dir, filename);
    if (fs.existsSync(filePath) && !FORCE) {
      skipped++;
      continue;
    }
    fs.writeFileSync(filePath, content);
    written++;
  }
}

console.log(`Generated ${written} files, skipped ${skipped} existing files. Modules: ${MODULES.length}`);
