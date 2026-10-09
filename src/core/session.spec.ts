import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionService, isBillableRate } from './session';
import { walletService } from './wallet';

const { payMock } = vi.hoisted(() => ({ payMock: vi.fn() }));

vi.mock('./wallet', () => ({
    walletService: {
        getSessionRecord: vi.fn(),
        clearSession: vi.fn(),
    }
}));

vi.mock('@circle-fin/x402-batching/client', () => ({
    GatewayClient: class {
        async getBalances() {
            return { gateway: { formattedAvailable: '0.005' } };
        }
        async withdraw() {
            return { formattedAmount: '0.00495', mintTxHash: '0xabc123' };
        }
        pay = payMock;
    }
}));

const BASE_REQUEST = {
    resourceId: 'video_test',
    ratePerSecond: '0.0001',
    payoutAddress: '0x000000000000000000000000000000000000dead',
    splits: [],
};

describe('SessionService', () => {
    let sessionService: SessionService;

    beforeEach(() => {
        sessionService = new SessionService();
        vi.clearAllMocks();
    });

    it('records a join and allows parting without clearing the session key', async () => {
        const userId = 'user_test_1';

        sessionService.recordJoin(userId, BASE_REQUEST);
        expect(sessionService.hasActiveSession(userId)).toBe(true);

        await sessionService.recordPartAndSettle(userId);

        expect(sessionService.hasActiveSession(userId)).toBe(false);
        expect(walletService.clearSession).not.toHaveBeenCalled();
    });

    it('handles parting without an active session gracefully', async () => {
        await sessionService.recordPartAndSettle('unknown_user');
        expect(sessionService.hasActiveSession('unknown_user')).toBe(false);
    });

    it('throws on invalid payoutAddress', () => {
        expect(() =>
            sessionService.recordJoin('user_bad', { ...BASE_REQUEST, payoutAddress: 'not-an-address' })
        ).toThrow('Invalid payoutAddress');
    });

    it('throws when split fractions sum to > 1', () => {
        expect(() =>
            sessionService.recordJoin('user_bad', {
                ...BASE_REQUEST,
                splits: [
                    { address: '0x000000000000000000000000000000000000beef', fraction: 0.7 },
                    { address: '0x000000000000000000000000000000000000cafe', fraction: 0.5 },
                ],
            })
        ).toThrow('fractions sum to');
    });
});

describe('isBillableRate', () => {
    it('rejects rates that format to $0.000000', () => {
        expect(isBillableRate(0)).toBe(false);
        expect(isBillableRate(0.0000004)).toBe(false);
    });

    it('accepts rates of at least 1 micro-USDC', () => {
        expect(isBillableRate(0.000001)).toBe(true);
        expect(isBillableRate(0.0001)).toBe(true);
    });
});

describe('SessionService payment loop', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        payMock.mockResolvedValue({ formattedAmount: '0.0001' });
        vi.mocked(walletService.getSessionRecord).mockReturnValue({
            privateKey: `0x${'1'.repeat(64)}`,
            returnAddress: '0x000000000000000000000000000000000000dead',
        });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('does not call Gateway for a rate "0" session', async () => {
        const service = new SessionService();
        service.recordJoin('email:free@example.com', { ...BASE_REQUEST, ratePerSecond: '0' });

        await vi.advanceTimersByTimeAsync(3500);

        expect(payMock).not.toHaveBeenCalled();
        expect(service.hasActiveSession('email:free@example.com')).toBe(true);
    });

    it('still bills a session with a positive rate', async () => {
        const service = new SessionService();
        service.recordJoin('email:paid@example.com', BASE_REQUEST);

        await vi.advanceTimersByTimeAsync(3500);

        expect(payMock).toHaveBeenCalled();
    });
});
