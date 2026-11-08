export interface DigitalTwinState {
  vehicleId: string;
  organizationId: string;
  lastUpdatedAt: string; // ISO-8601

  position?: {
    latitude: number;
    longitude: number;
    speed: number;
    heading: number;
    accuracy?: number;
  };

  status: 'idle' | 'moving' | 'stopped' | 'parked' | 'offline';
  ignition: boolean;
  fuelLevel?: number;

  ev?: {
    soc: number;
    charging: boolean;
  };

  assignedDriverId?: string;
  activeTripId?: string;
  geofences: string[]; // geofence IDs the vehicle is currently confirmed inside
  alerts: string[]; // unresolved alert IDs affecting this vehicle

  deviceHealth: {
    online: boolean;
    lastCommunicationAt?: string;
    signalStrength?: number;
    batteryLevel?: number;
  };
}

export type DigitalTwinPatch = Partial<Omit<DigitalTwinState, 'vehicleId' | 'organizationId'>>;
