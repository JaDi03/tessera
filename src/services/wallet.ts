import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';

export interface BatchEvmSigner {
    address: `0x${string}`;
    signTypedData: (params: any) => Promise<`0x${string}`>;
}

/**
 * Wallet Abstraction Service
 * Manages the custody of Session Keys delegated by the viewers.
 */
export class WalletService {
    // Stores ephemeral private keys in memory mapped by userId
    private sessionKeys = new Map<string, Hex>();

    /**
     * Registers a funded ephemeral key for a user
     */
    public registerSessionKey(userId: string, privateKey: string): void {
        this.sessionKeys.set(userId, privateKey as Hex);
        console.log(`[Wallet] 🔐 Ephemeral Key registered securely for user: ${userId}`);
    }

    /**
     * Retrieves the session key (BatchEvmSigner) for a specific user.
     */
    public async getSessionSignerForUser(userId: string): Promise<BatchEvmSigner> {
        // Retrieve the ephemeral key provided during the Lobby phase
        const privateKeyHex = this.sessionKeys.get(userId);
        
        if (!privateKeyHex) {
            throw new Error(`No session key found for user ${userId}. User must fund a session key via the Lobby.`);
        }

        const account = privateKeyToAccount(privateKeyHex);

        return {
            address: account.address,
            signTypedData: async (params) => account.signTypedData(params)
        };
    }
}

export const walletService = new WalletService();
