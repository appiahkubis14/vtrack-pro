import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ForgotPasswordDto, ResetPasswordDto } from './dto/reset-password.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: 'Register a new user (and organization, if none given)' })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @ApiOperation({ summary: 'Log in with email + password (+ TOTP if 2FA enabled)' })
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.login(dto, { ip: req.ip, userAgent: req.get('user-agent') });
  }

  @Post('refresh-token')
  @ApiOperation({ summary: 'Exchange a refresh token for a new token pair' })
  refreshToken(@Body() body: { userId: string; refreshToken: string }) {
    return this.authService.refreshToken(body.userId, body.refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('logout')
  @ApiOperation({ summary: 'Revoke all active sessions for the current user' })
  logout(@Req() req: Request) {
    const user = req.user as { sub: string };
    return this.authService.logout(user.sub);
  }

  @Post('forgot-password')
  @ApiOperation({ summary: 'Request a password reset email' })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Post('reset-password')
  @ApiOperation({ summary: 'Reset password using a reset token' })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Post('verify-email')
  @ApiOperation({ summary: 'Verify email using a verification token' })
  verifyEmail(@Body() body: { token: string }) {
    // TODO: wire to an email-verification-token store, mirroring reset-password.
    return { success: true, note: 'verify-email not yet wired to a token store' };
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('2fa/enable')
  @ApiOperation({ summary: 'Start 2FA setup - returns a QR/otpauth URL' })
  enable2fa(@Req() req: Request) {
    const user = req.user as { sub: string };
    return this.authService.enable2fa(user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('2fa/verify')
  @ApiOperation({ summary: 'Confirm 2FA setup with a TOTP code - returns backup codes' })
  verify2fa(@Req() req: Request, @Body() body: { token: string }) {
    const user = req.user as { sub: string };
    return this.authService.verify2fa(user.sub, body.token);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('2fa/disable')
  @ApiOperation({ summary: 'Disable 2FA for the current user' })
  disable2fa(@Req() req: Request) {
    const user = req.user as { sub: string };
    return this.authService.disable2fa(user.sub);
  }
}
