// CASL-style actions/subjects used across guards and services.
export enum Action {
  MANAGE = 'manage', // wildcard, matches any action
  CREATE = 'create',
  READ = 'read',
  UPDATE = 'update',
  DELETE = 'delete',
  COMMAND = 'command', // send a remote device command
  ACKNOWLEDGE = 'acknowledge', // acknowledge/resolve an alert
}

export enum Subject {
  ALL = 'all',
  ORGANIZATION = 'Organization',
  USER = 'User',
  DEVICE = 'Device',
  VEHICLE = 'Vehicle',
  DRIVER = 'Driver',
  GEOFENCE = 'Geofence',
  ALERT = 'Alert',
  TRIP = 'Trip',
  MAINTENANCE = 'Maintenance',
  REPORT = 'Report',
  REMOTE_COMMAND = 'RemoteCommand',
}
