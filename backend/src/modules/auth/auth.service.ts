import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import * as speakeasy from 'speakeasy';
import { Repository } from 'typeorm';
import { Organization } from '../organizations/entities/organization.entity';
import { Role } from '../../common/constants/roles.constant';
import { User } from './entities/user.entity';
import { UserSession } from './entities/user-session.entity';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ForgotPasswordDto, ResetPasswordDto } from './dto/reset-password.dto';

const BCRYPT_ROUNDS = 12;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(UserSession) private readonly sessions: Repository<UserSession>,
    @InjectRepository(Organization) private readonly organizations: Repository<Organization>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.users.findOne({ where: { email: dto.email } });
    if (existing) throw new ConflictException('An account with that email already exists');

    // Joining an existing organization must go through an invitation by its administrator. Letting a public caller
    // name any organizationId would let anyone create an account inside someone else's tenant.
    if (dto.organizationId) {
      throw new ForbiddenException('Joining an existing organization requires an invitation from its administrator');
    }
    let organizationId: string | undefined;
    {
      if (!dto.organizationName) {
        throw new BadRequestException('organizationName is required when organizationId is omitted');
      }
      const org = await this.organizations.save(
        this.organizations.create({
          name: dto.organizationName,
          slug: this.slugify(dto.organizationName),
        }),
      );
      organizationId = org.id;
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const user = await this.users.save(
      this.users.create({
        email: dto.email,
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        organizationId,
        role: organizationId === dto.organizationId ? Role.VIEWER : Role.ORG_ADMIN,
      }),
    );

    // TODO: send a verification email via NotificationsService (email.channel.ts)
    return { id: user.id, email: user.email, organizationId: user.organizationId };
  }

  async login(dto: LoginDto, meta: { ip?: string; userAgent?: string } = {}): Promise<TokenPair & { user: Partial<User> }> {
    const user = await this.users.findOne({ where: { email: dto.email } });
    if (!user || !user.isActive) throw new UnauthorizedException('Invalid credentials');

    const passwordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordValid) throw new UnauthorizedException('Invalid credentials');

    if (user.twoFactorEnabled) {
      if (!dto.twoFactorCode) {
        throw new UnauthorizedException('Two-factor code required');
      }
      const verified = speakeasy.totp.verify({
        secret: user.twoFactorSecret!,
        encoding: 'base32',
        token: dto.twoFactorCode,
        window: 1,
      });
      if (!verified) throw new UnauthorizedException('Invalid two-factor code');
    }

    const tokens = await this.issueTokenPair(user);

    await this.sessions.save(
      this.sessions.create({
        userId: user.id,
        refreshToken: await bcrypt.hash(tokens.refreshToken, BCRYPT_ROUNDS),
        ipAddress: meta.ip,
        userAgent: meta.userAgent,
        expiresAt: this.addDuration(new Date(), this.config.get<string>('jwt.refreshExpiresIn') ?? '7d'),
      }),
    );

    await this.users.update(user.id, {
      lastLoginAt: new Date(),
      lastLoginIp: meta.ip,
      loginCount: (user.loginCount ?? 0) + 1,
    });

    return {
      ...tokens,
      user: { id: user.id, email: user.email, role: user.role, organizationId: user.organizationId, mustChangePassword: user.mustChangePassword },
    };
  }

  async refreshToken(userId: string, presentedToken: string): Promise<TokenPair> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Invalid session');

    // Refresh-token rotation: the presented token must match a live, unrevoked session.
    const activeSessions = await this.sessions.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
    const match = await Promise.all(
      activeSessions
        .filter((s) => !s.revokedAt && s.expiresAt > new Date())
        .map(async (s) => ((await bcrypt.compare(presentedToken, s.refreshToken)) ? s : null)),
    );
    const session = match.find(Boolean);
    if (!session) throw new UnauthorizedException('Refresh token expired or revoked');

    await this.sessions.update(session.id, { revokedAt: new Date() });

    const tokens = await this.issueTokenPair(user);
    await this.sessions.save(
      this.sessions.create({
        userId: user.id,
        refreshToken: await bcrypt.hash(tokens.refreshToken, BCRYPT_ROUNDS),
        expiresAt: this.addDuration(new Date(), this.config.get<string>('jwt.refreshExpiresIn') ?? '7d'),
      }),
    );

    return tokens;
  }

  async logout(userId: string) {
    await this.sessions.update({ userId }, { revokedAt: new Date() });
    return { success: true };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.users.findOne({ where: { email: dto.email } });
    // Always return success to avoid leaking which emails are registered.
    if (!user) return { success: true };

    const resetToken = crypto.randomBytes(32).toString('hex');
    // TODO: persist a hashed reset token + expiry (e.g. a password_reset_tokens table)
    // and email it via NotificationsService. Omitted here to keep the skeleton focused.
    void resetToken;
    return { success: true };
  }

  async resetPassword(dto: ResetPasswordDto) {
    // TODO: look up the hashed token, verify expiry, then update the user's password.
    void dto;
    throw new BadRequestException('Password reset token flow not wired to a store yet - see TODO');
  }

  async enable2fa(userId: string) {
    const user = await this.users.findOneOrFail({ where: { id: userId } });
    const secret = speakeasy.generateSecret({
      name: `${this.config.get<string>('jwt.appName') ?? 'V-Track Pro'} (${user.email})`,
    });
    await this.users.update(userId, { twoFactorSecret: secret.base32 });
    return { otpauthUrl: secret.otpauth_url, base32: secret.base32 };
  }

  async verify2fa(userId: string, token: string) {
    const user = await this.users.findOneOrFail({ where: { id: userId } });
    const verified = speakeasy.totp.verify({
      secret: user.twoFactorSecret!,
      encoding: 'base32',
      token,
      window: 1,
    });
    if (!verified) throw new UnauthorizedException('Invalid two-factor code');

    const backupCodes = Array.from({ length: 10 }, () => crypto.randomBytes(5).toString('hex'));
    await this.users.update(userId, { twoFactorEnabled: true, backupCodes });
    return { backupCodes };
  }

  async disable2fa(userId: string) {
    await this.users.update(userId, {
      twoFactorEnabled: false,
      twoFactorSecret: undefined,
      backupCodes: undefined,
    });
    return { success: true };
  }

  // ---------------------------------------------------------------------

  private async issueTokenPair(user: User): Promise<TokenPair> {
    const payload = {
      sub: user.id,
      email: user.email,
      organizationId: user.organizationId,
      role: user.role,
    };
    const accessExpiresIn = this.config.get<string>('jwt.accessExpiresIn') ?? '15m';
    const refreshExpiresIn = this.config.get<string>('jwt.refreshExpiresIn') ?? '7d';

    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(payload, {
        secret: this.config.get<string>('jwt.accessSecret'),
        expiresIn: accessExpiresIn,
      }),
      this.jwt.signAsync(payload, {
        secret: this.config.get<string>('jwt.refreshSecret'),
        expiresIn: refreshExpiresIn,
      }),
    ]);

    return { accessToken, refreshToken, expiresIn: accessExpiresIn };
  }

  private slugify(name: string): string {
    return `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-${crypto
      .randomBytes(3)
      .toString('hex')}`;
  }

  private addDuration(base: Date, duration: string): Date {
    const match = /^(\d+)([smhd])$/.exec(duration);
    if (!match) return new Date(base.getTime() + 7 * 24 * 60 * 60 * 1000);
    const [, amountStr, unit] = match;
    const amount = parseInt(amountStr, 10);
    const multipliers: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
    return new Date(base.getTime() + amount * multipliers[unit]);
  }
}
