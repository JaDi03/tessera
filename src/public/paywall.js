// arc-paywall.js - Injected by Reverse Proxy

// Include ethers.js via CDN dynamically if not present
if (!window.ethers) {
    const script = document.createElement('script');
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/ethers/6.7.0/ethers.umd.min.js";
    document.head.appendChild(script);
}

// USDC Contract on Base Sepolia
const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const USDC_ABI = [
    "function transfer(address to, uint256 amount) returns (bool)",
    "function decimals() view returns (uint8)"
];

let ephemeralWallet = null;

function initPaywall() {
    // Inject CSS if not present
    if (!document.getElementById('arc-paywall-css')) {
        const link = document.createElement('link');
        link.id = 'arc-paywall-css';
        link.rel = 'stylesheet';
        link.href = '/paywall.css'; // Served by our proxy
        document.head.appendChild(link);
    }

    // Lock the body
    document.body.classList.add('arc-locked');

    // Create the overlay and modal
    const overlay = document.createElement('div');
    overlay.id = 'arc-paywall-overlay';

    overlay.innerHTML = `
        <div id="arc-paywall-modal">
            <h2>Premium Stream</h2>
            <p>To watch this stream seamlessly, please fund your session. We use Circle Nanopayments (x402) so you only pay exactly for the seconds you watch.</p>
            <button id="arc-connect-btn" class="arc-btn">Connect Wallet & Fund</button>
            <p id="arc-paywall-status" style="margin-top: 15px; font-size: 12px; color: #63b3ed; display: none;"></p>
        </div>
    `;
    
    document.body.appendChild(overlay);

    document.getElementById('arc-connect-btn').addEventListener('click', handleFundSession);
}

async function updateStatus(text) {
    const status = document.getElementById('arc-paywall-status');
    status.style.display = 'block';
    status.innerText = text;
}

async function handleFundSession() {
    const btn = document.getElementById('arc-connect-btn');
    btn.disabled = true;
    
    try {
        if (!window.ethereum) {
            throw new Error("MetaMask is not installed!");
        }

        await updateStatus("Connecting to MetaMask...");
        const provider = new ethers.BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();

        // Ensure we are on Base Sepolia
        const network = await provider.getNetwork();
        if (network.chainId !== 84532n) {
            await window.ethereum.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: '0x14a34' }] // 84532 in hex
            });
        }

        await updateStatus("Generating Session Key...");
        ephemeralWallet = ethers.Wallet.createRandom();
        console.log("Ephemeral Address:", ephemeralWallet.address);

        await updateStatus("Please confirm USDC funding in MetaMask...");
        const usdcContract = new ethers.Contract(USDC_ADDRESS, USDC_ABI, signer);
        
        // Fund 1 USDC (1,000,000 base units)
        const amount = ethers.parseUnits("1", 6); 
        
        // Execute the transfer to the ephemeral wallet
        const tx = await usdcContract.transfer(ephemeralWallet.address, amount);
        await updateStatus("Waiting for blockchain confirmation...");
        await tx.wait();

        await updateStatus("Funding Gateway and Opening Stream...");
        const viewerId = localStorage.getItem('owncast_viewer_id');
        
        // Send the ephemeral private key to the Sidecar so it can deposit to Gateway and settle later
        const response = await fetch('/v1/webhooks/register-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                userId: viewerId,
                privateKey: ephemeralWallet.privateKey,
                address: ephemeralWallet.address 
            })
        });

        if (!response.ok) {
            throw new Error("Backend failed to register session.");
        }

        // Success! Remove the paywall
        document.body.classList.remove('arc-locked');
        const overlay = document.getElementById('arc-paywall-overlay');
        overlay.style.opacity = '0';
        setTimeout(() => overlay.remove(), 500);

    } catch (error) {
        console.error(error);
        await updateStatus("Error: " + error.message);
        btn.disabled = false;
    }
}

// Start the paywall once the page loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPaywall);
} else {
    initPaywall();
}
