import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface DebitResult {
  success: boolean;
  reference?: string;
  failureReason?: string;
}

/**
 * Phase 1: mock/sandbox implementation. The processor that calls this never
 * needs to change once a real Hubtel/Paystack merchant account is live -
 * only this class's internals swap from the deterministic mock below to a
 * real HTTP call against the aggregator's charge API.
 *
 * IMPORTANT: this mock is NOT a substitute for testing against the real
 * aggregator's actual sandbox environment before the September test run -
 * real MTN MoMo/Telecel Cash sandbox behavior (timeout patterns, webhook
 * delivery reliability over Ghanaian mobile networks, USSD prompt timing)
 * cannot be represented by a mock that always resolves instantly. Use this
 * to validate the state machine's logic now; swap to the real sandbox
 * endpoint as early as possible once merchant KYC clears, specifically to
 * surface real-world timeout/retry behavior before it's a production
 * problem instead of a test-run one.
 */
@Injectable()
export class PaymentGatewayService {
  private readonly logger = new Logger(PaymentGatewayService.name);

  constructor(private readonly config: ConfigService) {}

  async requestDebit(phone: string, amount: number): Promise<DebitResult> {
    const mode = this.config.get<string>('PAYMENT_GATEWAY_MODE', 'mock');

    if (mode === 'mock') {
      return this.mockDebit(phone, amount);
    }

    // TODO Phase 1 completion: real Hubtel/Paystack charge request here,
    // reading PAYMENT_GATEWAY_API_KEY / PAYMENT_GATEWAY_MERCHANT_ID from
    // config. The webhook callback that confirms/denies the charge
    // asynchronously needs its own controller endpoint (not shown here) that
    // updates the matching payment_logs row by aggregatorReference - a MoMo
    // debit is not synchronous, the initial HTTP response only confirms the
    // USSD prompt was sent to the rider's phone, not that they approved it.
    throw new Error(`Payment gateway mode "${mode}" not yet implemented - only "mock" is available in Phase 1`);
  }

  private async mockDebit(phone: string, amount: number): Promise<DebitResult> {
    this.logger.log(`[MOCK] Requesting GHS ${amount} debit from ${phone}`);
    await new Promise((resolve) => setTimeout(resolve, 200)); // simulate network latency

    // Deterministic based on phone number so integration tests can exercise
    // both the success and grace-period paths reliably: any number ending
    // in an even digit "succeeds", odd "fails" - documented here so nobody
    // mistakes this for real randomness later.
    const lastDigit = Number(phone.slice(-1));
    const success = Number.isFinite(lastDigit) && lastDigit % 2 === 0;

    return success
      ? { success: true, reference: `MOCK-${Date.now()}` }
      : { success: false, failureReason: 'Mock gateway: simulated insufficient balance' };
  }
}
