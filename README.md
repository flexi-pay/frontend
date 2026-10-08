# Starling, by FlexiPay

**Starling** is a non-custodial Stellar wallet that runs as a website and as a Chrome extension. You can send and receive in seconds, pay by scanning a code, use a name like `nuel*flexipay.app` instead of an address, convert between assets on the Stellar DEX, cash in and out through anchors, and pay strangers safely with a Soroban escrow.

| Repo | What it is |
|---|---|
| **flexi-pay/frontend** | This repo: the Starling wallet (React + Vite + TypeScript) |
| [flexi-pay/backend](https://github.com/flexi-pay/backend) | Names and federation service (SEP-1, SEP-2, SEP-53) |
| [flexi-pay/contracts](https://github.com/flexi-pay/contracts) | Soroban contracts in Rust (Safe pay escrow) |

## Features

- **Any wallet:** create or import a built-in wallet, or connect Freighter, xBull, Albedo, LOBSTR, Hana, Rabet and others through Stellar Wallets Kit.
- **Built-in wallet security:** the key is encrypted on the device with PBKDF2-SHA256 (310k iterations) and AES-256-GCM, and the wallet locks itself after 15 minutes idle.
- **Send:** XLM or any asset, to a `G…` address **or a name** (`name*domain`, SEP-2). Memos the recipient requires are filled in automatically.
- **FlexiPay names:** claim `you*flexipay.app` in Settings. You prove the account is yours with a SEP-53 signed message, so there's no password.
- **Receive and scan to pay:** SEP-7 QR payment requests with the amount and memo included. You can scan with the camera, upload a photo of a code, or paste one.
- **Convert:** strict-send path payments on the Stellar DEX, with a live quote, the route and a slippage limit.
- **Cash in and out:** SEP-10 sign-in and SEP-24 deposits and withdrawals with any anchor.
- **Safe pay:** a Soroban escrow. Release the money on delivery, or get it back after the deadline.
- **Assets and Activity:** manage trustlines and see your full history with explorer links.
- **Look and feel:** light and dark themes, mobile layout with a bottom navigation bar, and a Chrome MV3 extension popup.

## Run

```bash
cp .env.example .env
npm install
npm run dev               # http://localhost:5173 (testnet)
npm test                  # unit tests
npm run build             # website → dist/
npm run build:extension   # Chrome extension → dist-extension/
```

### Configuration (`.env`)

| Variable | Purpose |
|---|---|
| `VITE_STELLAR_NETWORK` | `testnet` (default) or `mainnet` |
| `VITE_ESCROW_CONTRACT_ID` | Safe pay contract, from `flexi-pay/contracts` → `scripts/deploy.sh` |
| `VITE_NAMES_API` | URL of `flexi-pay/backend`, for example `http://localhost:8080` |
| `VITE_NAMES_DOMAIN` | The domain names live under, for example `flexipay.app` |
| `VITE_SOROBAN_RPC_URL` | Required on mainnet |

### Chrome extension

1. Run `npm run build:extension`.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select `dist-extension`.

### Deploy

GitHub Pages deploys automatically from `main`: set **Settings → Pages → Source** to **GitHub Actions**. Contract IDs and the names API come from repository variables.

On Vercel or Netlify, use framework **Vite**, build command `npm run build`, and output folder `dist`.

> Testnet is the default. Have the code security-reviewed before you handle real funds.

## License

MIT
