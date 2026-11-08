export enum AlertSeverity {
  CRITICAL = 'critical',
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
}

export enum AlertType {
  // Safety
  SPEEDING = 'speeding',
  HARSH_BRAKING = 'harsh_braking',
  HARSH_ACCELERATION = 'harsh_acceleration',
  SHARP_TURNING = 'sharp_turning',
  COLLISION_DETECTED = 'collision_detected',
  ROLLOVER_DETECTED = 'rollover_detected',
  SOS_PANIC = 'sos_panic',

  // Geofence
  GEOFENCE_ENTRY = 'geofence_entry',
  GEOFENCE_EXIT = 'geofence_exit',
  GEOFENCE_DWELL = 'geofence_dwell',
  ROUTE_DEVIATION = 'route_deviation',

  // Fuel
  FUEL_THEFT = 'fuel_theft',
  REFUELING_DETECTED = 'refueling_detected',
  LOW_FUEL = 'low_fuel',
  RAPID_FUEL_DROP = 'rapid_fuel_drop',
  FUEL_SENSOR_FAILURE = 'fuel_sensor_failure',

  // Vehicle
  ENGINE_FAULT = 'engine_fault',
  LOW_BATTERY = 'low_battery',
  DEVICE_OFFLINE = 'device_offline',
  MAINTENANCE_DUE = 'maintenance_due',
  OBD_FAULT_CODE = 'obd_fault_code',
  TIRE_PRESSURE_LOW = 'tire_pressure_low',
  DOOR_OPEN = 'door_open',

  // Driver
  FATIGUE_DETECTED = 'fatigue_detected',
  HOS_VIOLATION = 'hos_violation',
  UNAUTHORIZED_DRIVER = 'unauthorized_driver',

  // Security
  TAMPERING_DETECTED = 'tampering_detected',
  GPS_JAMMING = 'gps_jamming',
  SIM_SWAP = 'sim_swap',
  DEVICE_REMOVAL = 'device_removal',
}

export enum DeviceStatus {
  IDLE = 'idle',
  MOVING = 'moving',
  STOPPED = 'stopped',
  PARKED = 'parked',
  OFFLINE = 'offline',
}

export enum CommandStatus {
  CREATED = 'created',
  APPROVED = 'approved',
  PENDING = 'pending', // kept for v1 compatibility - treated as an alias of QUEUED
  QUEUED = 'queued',
  WAITING_FOR_DEVICE = 'waiting_for_device',
  SENT = 'sent',
  DELIVERED = 'delivered',
  ACKNOWLEDGED = 'acknowledged',
  EXECUTED = 'executed',
  FAILED = 'failed',
  TIMEOUT = 'timeout',
  CANCELLED = 'cancelled',
}
