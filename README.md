# RPCPay Platform v0.3.0

RPCPay is a lightweight, self-hosted cryptocurrency donation/payment gateway focused on direct blockchain RPC verification rather than a large ecommerce stack or a custodial payment processor.

It provides campaign pages, goals, per-payment deposit addresses, confirmations, signed webhooks and automatic sweeping to your treasury wallet.

## v0.3 highlights

- Native payments: ETH, POL, BNB, TRX, SOL, BTC, DOGE, LTC, BCH, DASH, PIVX and Bitcoin Lightning
- Generic **ERC-20 / BEP-20 / EVM token** adapter
- Generic **TRC-20** adapter
- Generic **SPL Token / Token-2022** adapter
- Included USDC and USDT presets
- Multiple RPC endpoints with health-based failover
- PublicNode-ready defaults for EVM, TRON and Solana networks
- Optional NOWNodes endpoints/API key
- Token gas-sponsor wallets for automatic token sweeping
- Public campaign pages with goals and verified totals
- Admin UI for owner wallet, enable/disable, auto-sweep and multi-RPC configuration
- GitHub Actions test + multi-architecture Docker build
- Automatic GHCR publishing on `main` and version tags

## Payment architecture

```text
Campaign / website
       |
       v
Create invoice
       |
       +-- native EVM / TRX / SOL --> unique temporary wallet
       +-- ERC20/TRC20/SPL token --> unique temporary wallet
       +-- BTC/DOGE/etc -----------> daemon getnewaddress
       +-- Lightning --------------> LND BOLT11 invoice
       |
       v
Customer pays
       |
       v
RPC verification + confirmations
       |
       v
payment.confirmed
       |
       +-- native asset ---> sweep balance - network fee
       |
       +-- token ----------> gas sponsor funds network fee if needed
       |                     then token is swept to treasury
       |
       +-- Lightning ------> already settled in LND
       |
       v
payment.swept
```

## Included payment assets

### Native assets

| Asset | Adapter | Verification | Sweep |
|---|---|---|---|
| Ethereum / ETH | EVM | JSON-RPC | automatic |
| Polygon / POL | EVM | JSON-RPC | automatic |
| Base / ETH | EVM | JSON-RPC | automatic |
| BNB Smart Chain / BNB | EVM | JSON-RPC | automatic |
| TRON / TRX | TronWeb/full-node API | block scan | automatic |
| Solana / SOL | Solana JSON-RPC | signature/balance | automatic |
| Bitcoin / BTC | Core-compatible wallet RPC | wallet RPC | automatic |
| Dogecoin / DOGE | Core-compatible wallet RPC | wallet RPC | automatic |
| Litecoin / LTC | Core-compatible wallet RPC | wallet RPC | automatic |
| Bitcoin Cash / BCH | Core-compatible wallet RPC | wallet RPC | automatic |
| Dash / DASH | Core-compatible wallet RPC | wallet RPC | automatic |
| PIVX / PIVX | Core-compatible wallet RPC | wallet RPC | automatic |
| Bitcoin Lightning | LND REST | invoice state | already in LND |

### Included token presets

| ID | Asset | Network | Standard |
|---|---|---|---|
| `ethereum-usdc` | USDC | Ethereum | ERC-20 |
| `ethereum-usdt` | USDT | Ethereum | ERC-20 |
| `base-usdc` | USDC | Base | ERC-20 |
| `polygon-usdc` | USDC | Polygon | ERC-20 |
| `bnb-usdt` | Binance-Peg USDT | BNB Smart Chain | BEP-20/EVM; disabled by default |
| `tron-usdt` | USDT | TRON | TRC-20 |
| `solana-usdc` | USDC | Solana | SPL Token |
| `solana-usdt` | USDT | Solana | SPL Token |

USDC/USDT contract and mint identifiers in the example config are issuer/network presets. Always verify token addresses before accepting mainnet money.

## "All tokens" support

RPCPay does not need Coinbase to accept a token. A payment asset is defined by its **network + contract/mint + decimals**.

Any normal ERC-20/BEP-20-style token can use `evm-token`, any normal TRC-20 can use `tron-token`, and SPL/Token-2022 assets can use `solana-token`.

Example arbitrary ERC-20 token:

```json
{
  "id": "base-my-token",
  "name": "My Token on Base",
  "symbol": "MYT",
  "adapter": "evm-token",
  "networkId": "base",
  "contractAddress": "0xYOUR_TOKEN_CONTRACT",
  "decimals": 18,
  "confirmations": 12,
  "priceId": "",
  "enabled": false
}
```

Example TRC-20:

```json
{
  "id": "tron-my-token",
  "name": "My TRC20 Token",
  "symbol": "MYT",
  "adapter": "tron-token",
  "networkId": "tron",
  "contractAddress": "TYourContractAddress",
  "decimals": 6,
  "confirmations": 19,
  "priceId": "",
  "gasTopupAtomic": "30000000",
  "feeLimitSun": 100000000,
  "enabled": false
}
```

Example SPL token:

```json
{
  "id": "solana-my-token",
  "name": "My SPL Token",
  "symbol": "MYT",
  "adapter": "solana-token",
  "networkId": "solana",
  "mintAddress": "YourMintAddress",
  "decimals": 6,
  "confirmations": 2,
  "priceId": "",
  "enabled": false
}
```

If a custom token is not supported by the configured price provider, direct crypto-amount invoices still work. To use it in a fiat-denominated campaign, configure a suitable `priceId` or add another price adapter.

## Token verification

### EVM tokens

RPCPay scans standard `Transfer(address,address,uint256)` logs using `eth_getLogs`, filtered by contract and invoice destination address. It then verifies the transaction receipt and confirmation depth.

### TRC-20

RPCPay scans TRON `TriggerSmartContract` transactions for the configured token contract and validates the standard `Transfer` event in the transaction receipt/logs.

### Solana tokens

RPCPay queries token accounts owned by the invoice wallet for the configured mint, checks the raw token amount, then checks the associated transaction signature status.

## Token gas sponsor wallets

A token deposit wallet normally contains only the token. It cannot move that token until it has the chain's native gas asset.

RPCPay therefore supports a small **gas sponsor hot wallet** per network:

```env
ETH_GAS_SPONSOR_PRIVATE_KEY=
POLYGON_GAS_SPONSOR_PRIVATE_KEY=
BASE_GAS_SPONSOR_PRIVATE_KEY=
BNB_GAS_SPONSOR_PRIVATE_KEY=
TRON_GAS_SPONSOR_PRIVATE_KEY=
SOLANA_GAS_SPONSOR_SECRET_KEY=
```

Recommended model:

```text
Cold/treasury wallet
        ^
        | token sweep
        |
Temporary invoice wallet <--- small gas top-up --- Gas sponsor hot wallet
```

Do **not** put your treasury/cold-wallet private key in a gas-sponsor variable. Keep only enough native coin in the sponsor wallet for expected sweep fees.

For EVM tokens, RPCPay estimates the token transfer gas, checks the temporary wallet's native balance and tops up only the required gas amount before sweeping.

For TRC-20, `gasTopupAtomic` controls the target TRX balance used for the token transfer. TRON energy/bandwidth economics change, so tune and test this value rather than assuming a fixed fee forever.

For SPL tokens, the sponsor is the Solana transaction fee payer and may also pay rent if the treasury's associated token account must be created.

## RPC providers and failover

Each asset/network can have multiple endpoints. RPCPay rotates healthy endpoints and temporarily backs off failing ones.

The example config includes PublicNode endpoints for:

```text
Ethereum  https://ethereum-rpc.publicnode.com
Polygon   https://polygon-bor-rpc.publicnode.com
Base      https://base-rpc.publicnode.com
BNB       https://bsc-rpc.publicnode.com
TRON      https://tron-rpc.publicnode.com
Solana    https://solana-rpc.publicnode.com
```

### NOWNodes

NOWNodes can be used as another failover provider without hardcoding an API key in Git:

```env
NOWNODES_API_KEY=your-key
ETH_NOWNODES_RPC_URL=https://eth.nownodes.io/
POLYGON_NOWNODES_RPC_URL=your-polygon-endpoint
BASE_NOWNODES_RPC_URL=your-base-endpoint
BNB_NOWNODES_RPC_URL=https://bsc.nownodes.io/
TRON_NOWNODES_RPC_URL=your-tron-endpoint
SOLANA_NOWNODES_RPC_URL=your-solana-endpoint
```

Use the exact endpoint shown in your NOWNodes dashboard. RPCPay sends `NOWNODES_API_KEY` in the server-side `api-key` header.

Provider credentials stay in `.env`; never put them in browser JavaScript.

## Why BTC/DOGE/PIVX still need your wallet node

Public providers are useful for blockchain reads, but the current Bitcoin-family adapter intentionally uses wallet RPC methods such as:

```text
getnewaddress
listreceivedbyaddress
sendtoaddress
```

A public RPC service should not expose a private wallet capable of signing withdrawals for you. Therefore BTC, DOGE, LTC, BCH, DASH and PIVX should normally point to **your own private daemon wallet**.

PublicNode/NOWNodes can be useful for independent read-only verification in a future watch-only adapter, but they do not replace custody/signing for the current wallet-RPC flow.

## Bitcoin Lightning

Lightning uses your own LND node:

```env
LND_REST_URL=https://lnd:8080
LND_MACAROON_HEX=...
```

RPCPay creates BOLT11 invoices and verifies settlement through LND. Use a least-privileged macaroon and never expose LND REST directly to the internet.

## Install from source

```bash
cp .env.example .env
cp config/chains.example.json config/chains.json
```

Generate independent secrets:

```bash
openssl rand -hex 32
```

Then:

```bash
docker compose up -d --build
```

Open:

```text
http://SERVER:8080/
http://SERVER:8080/admin
```

## Install the GitHub-built image

The GitHub workflow publishes multi-architecture images to GitHub Container Registry after changes land on `main`:

```bash
docker pull ghcr.io/nekosuneprojects/rpcpay-platform:latest
```

The compose file already uses that image name while retaining `build: .` for local development.

Published platforms:

```text
linux/amd64
linux/arm64
```

Version tags such as `v0.3.0` also generate matching GHCR tags.

## GitHub Actions

`.github/workflows/docker.yml` performs:

```text
checkout
  -> Node 24
  -> npm install
  -> syntax checks
  -> unit tests
  -> Docker Buildx
  -> amd64 + arm64 image build
  -> GHCR publish (main/tags only)
```

Pull requests build and test the image but do not publish it.

## Admin page

`/admin` lets you:

- create/manage campaigns
- set fundraising goal and fiat currency
- enable/disable payment assets
- configure owner/treasury addresses
- enable/disable automatic sweep
- configure more than one RPC endpoint per asset
- review payment and sweep status

Token entries appear in the same payment-asset list as native coins. Leaving a token owner address blank makes the adapter fall back to its parent network's owner wallet.

## Campaign accounting

Example:

```text
Goal: GBP 2,000
Donation: GBP 25
Payment asset: USDC on Base
```

The crypto amount is quoted when the invoice is created. Once the payment is confirmed, the original GBP 25 is counted toward the campaign goal, so later crypto price movements do not rewrite historical fundraising totals.

Pricing is separate from payment processing:

```env
PRICE_API_BASE=https://api.coingecko.com/api/v3
COINGECKO_API_KEY=
```

## Public website API

List payment assets:

```http
GET /api/public/chains
```

Create a campaign token invoice:

```http
POST /api/public/campaigns/server-costs/invoices
Content-Type: application/json

{
  "chainId": "base-usdc",
  "fiatAmount": "25.00"
}
```

Poll payment status:

```http
GET /api/public/invoices/inv_...
```

## Server API

```bash
curl -X POST http://127.0.0.1:8080/v1/invoices \
  -H "x-api-key: $API_KEY" \
  -H "content-type: application/json" \
  -d '{
    "chainId": "ethereum-usdt",
    "amount": "10.00",
    "webhookUrl": "https://example.com/payment-webhook"
  }'
```

## Webhooks

```text
payment.detected
payment.confirmed
payment.invalidated
payment.swept
invoice.expired
```

Signatures use:

```text
HMAC-SHA256(WEBHOOK_SECRET, timestamp + "." + raw_request_body)
```

Headers:

```text
x-rpcpay-event
x-rpcpay-timestamp
x-rpcpay-signature
```

## Custody and security

For EVM, TRON and Solana invoice wallets, RPCPay encrypts generated private keys with AES-256-GCM before storing them in SQLite.

Back up both:

```text
SQLite database
WALLET_ENCRYPTION_KEY
```

If either is lost before a sweep, funds held by temporary invoice wallets may become unrecoverable.

Also:

- use HTTPS in production
- keep the admin panel protected
- never expose Bitcoin-family wallet RPC ports publicly
- never commit `.env`
- use dedicated low-balance gas sponsor wallets
- test every token on testnet/devnet or with tiny values first
- verify contract/mint addresses from the issuer before enabling mainnet payments
- remember that fee-on-transfer/rebasing/non-standard tokens may need a custom adapter even if they resemble ERC-20

## Current limitations

- Generic token support assumes normal transfer semantics. Fee-on-transfer, rebasing, reflection and unusual proxy/token behavior can require custom handling.
- Split/partial token payments are not accumulated across multiple transactions yet; a single transfer must meet the invoice amount.
- TRC-20 gas top-up is configurable rather than dynamically buying/delegating TRON Energy.
- Bitcoin-family wallet RPC uses your daemon wallet; a watch-only/public-RPC + offline signer mode is a future adapter.
- Lightning currently targets LND; Core Lightning is not yet included.
- This software is custodial payment infrastructure. Review and test it before using real funds.
