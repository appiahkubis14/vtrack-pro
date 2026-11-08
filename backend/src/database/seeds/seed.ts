import { config } from 'dotenv';
import * as bcrypt from 'bcrypt';
import dataSource from '../../config/typeorm.config';
import { Organization } from '../../modules/organizations/entities/organization.entity';
import { User } from '../../modules/auth/entities/user.entity';
import { Vehicle } from '../../modules/vehicles/entities/vehicle.entity';
import { Device, DeviceProtocol } from '../../modules/devices/entities/device.entity';
import { Role } from '../../common/constants/roles.constant';

config();

async function seed() {
  await dataSource.initialize();
  console.log('Connected. Seeding demo data...');

  const orgRepo = dataSource.getRepository(Organization);
  const userRepo = dataSource.getRepository(User);
  const vehicleRepo = dataSource.getRepository(Vehicle);
  const deviceRepo = dataSource.getRepository(Device);

  let org = await orgRepo.findOne({ where: { slug: 'demo-fleet' } });
  if (!org) {
    org = await orgRepo.save(orgRepo.create({ name: 'Demo Fleet Co', slug: 'demo-fleet' }));
    console.log(`Created organization: ${org.id}`);
  }

  let admin = await userRepo.findOne({ where: { email: 'admin@vtrack.local' } });
  if (!admin) {
    admin = await userRepo.save(
      userRepo.create({
        organizationId: org.id,
        email: 'admin@vtrack.local',
        passwordHash: await bcrypt.hash('ChangeMe123!', 12),
        firstName: 'Demo',
        lastName: 'Admin',
        role: Role.ORG_ADMIN,
        isEmailVerified: true,
      }),
    );
    console.log(`Created admin user: ${admin.email} / ChangeMe123! (change this immediately)`);
  }

  let vehicle = await vehicleRepo.findOne({ where: { plateNumber: 'DEMO-001' } });
  if (!vehicle) {
    vehicle = await vehicleRepo.save(
      vehicleRepo.create({
        organizationId: org.id,
        plateNumber: 'DEMO-001',
        make: 'Toyota',
        model: 'Hilux',
        year: 2022,
        fuelType: 'diesel',
        tankCapacity: 80,
      }),
    );
    console.log(`Created vehicle: ${vehicle.plateNumber}`);
  }

  const existingDevice = await deviceRepo.findOne({ where: { imei: '000000000000001' } });
  if (!existingDevice) {
    const device = await deviceRepo.save(
      deviceRepo.create({
        organizationId: org.id,
        vehicleId: vehicle.id,
        imei: '000000000000001',
        name: 'Demo Tracker',
        protocol: DeviceProtocol.GT06,
        config: { speedLimitKmh: 100 },
      }),
    );
    console.log(`Created device: ${device.imei}`);
  }

  console.log('Seed complete.');
  await dataSource.destroy();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
