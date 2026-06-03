import { Router, Request, Response } from 'express';
import { baseSepolia } from 'viem/chains';
import { sessionService } from '../services/session';
import { walletService } from '../services/wallet';
import type { OwncastWebhookPayload, WebhookUserJoinedEventData, WebhookUserPartEventData } from '../types/owncast';

import { GatewayClient } from '@circle-fin/x402-batching/client';
import { privateKeyToAccount } from 'viem/accounts';

const router = Router();

router.post('/register-session', async (req: Request, res: Response) => {
    const { userId, privateKey, address } = req.body;
    
    if (!userId || !privateKey) {
        return res.status(400).json({ error: "Missing userId or privateKey" });
    }

    try {
        console.log(`\n[Gateway] 💳 Processing initial deposit for user ${userId}...`);
        
        // Initialize Gateway Client with the funded ephemeral key
        const gatewayClient = new GatewayClient({ 
            privateKey: privateKey as `0x${string}`, 
            chain: "baseSepolia" 
        });
        
        // Deposit 1 USDC (1,000,000 base units) to the Gateway Contract
        // The ephemeral key already received this USDC from MetaMask in the frontend
        const depositReceipt = await gatewayClient.deposit('1000000');
        console.log(`[Gateway] ✅ Deposit of 1 USDC confirmed. Receipt: ${JSON.stringify(depositReceipt)}`);

        // Securely store the ephemeral key for settlement later
        walletService.registerSessionKey(userId, privateKey);
        
        return res.json({ status: "session_registered", depositReceipt: depositReceipt });
    } catch (error: any) {
        console.error(`[Gateway] ❌ Failed to deposit:`, error.message);
        return res.status(500).json({ error: "Failed to deposit to Gateway" });
    }
});

router.post('/owncast', async (req: Request, res: Response) => {
    const payload = req.body as OwncastWebhookPayload;

    if (!payload || !payload.eventData || !payload.eventData.user) {
        return res.status(400).json({ error: "Invalid Owncast Webhook format" });
    }

    const userId = payload.eventData.user.id;

    if (payload.type === 'USER_JOINED') {
        const eventData = payload.eventData as WebhookUserJoinedEventData;
        sessionService.recordJoin(eventData.user.id);
        return res.json({ status: "recorded" });
    } 
    else if (payload.type === 'USER_PARTED') {
        const eventData = payload.eventData as WebhookUserPartEventData;
        // Launch the promise but don't block the webhook response
        // Owncast needs to know we received the webhook quickly (fire & forget)
        sessionService.recordPartAndSettle(eventData.user.id).catch(console.error);
        return res.json({ status: "processing_settlement" });
    }

    return res.json({ status: "ignored_event_type" });
});

export default router;
