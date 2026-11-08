export enum DeviceRole {
  PRIMARY_GPS = 'PRIMARY_GPS',
  SECONDARY_GPS = 'SECONDARY_GPS',
  OBD_DIAGNOSTIC = 'OBD_DIAGNOSTIC',
  EV_CAN_GATEWAY = 'EV_CAN_GATEWAY',
  FUEL_SENSOR = 'FUEL_SENSOR',
  TEMPERATURE_SENSOR = 'TEMPERATURE_SENSOR',
  BLE_ASSET_TRACKER = 'BLE_ASSET_TRACKER',
  DASHCAM = 'DASHCAM',
  DRIVER_ID_READER = 'DRIVER_ID_READER',
  IMMOBILIZER_CONTROLLER = 'IMMOBILIZER_CONTROLLER',
}

export type TelemetryField = 'location' | 'fuel' | 'ev_battery' | 'ignition' | 'driver_identity';

/**
 * Default trust ordering per field when no explicit
 * device_telemetry_sources override exists for a vehicle. Lower index = more
 * trusted. A PRIMARY_GPS device wins location by default; an OBD_DIAGNOSTIC
 * device wins ignition state (reads it off the vehicle bus, not inferred
 * from motion); etc.
 */
export const DEFAULT_ROLE_PRIORITY: Record<TelemetryField, DeviceRole[]> = {
  location: [DeviceRole.PRIMARY_GPS, DeviceRole.SECONDARY_GPS, DeviceRole.BLE_ASSET_TRACKER],
  fuel: [DeviceRole.FUEL_SENSOR, DeviceRole.OBD_DIAGNOSTIC, DeviceRole.PRIMARY_GPS],
  ev_battery: [DeviceRole.EV_CAN_GATEWAY, DeviceRole.OBD_DIAGNOSTIC],
  ignition: [DeviceRole.OBD_DIAGNOSTIC, DeviceRole.IMMOBILIZER_CONTROLLER, DeviceRole.PRIMARY_GPS],
  driver_identity: [DeviceRole.DRIVER_ID_READER],
};
