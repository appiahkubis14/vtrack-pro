import { SetMetadata } from '@nestjs/common';
import { ROLES_KEY, Role } from '../constants/roles.constant';

export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
