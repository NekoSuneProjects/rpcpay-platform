# RPCPay Platform v0.4.0

RPCPay is a lightweight, self-hosted cryptocurrency donation/payment gateway focused on direct blockchain RPC verification rather than a custodial payment processor.

It provides campaign pages, fiat quoting, per-payment deposit addresses, confirmations, signed webhooks, automatic sweeping, token support, RPC failover and an EVM hot-wallet portfolio dashboard.

## v0.4 highlights

- **NOWNodes Market Data pricing** with CoinGecko fallback
- Price provider modes: `auto`, `nownodes`, or `coingecko`
- Admin **EVM Hot Wallet** portfolio page
- Shows native ETH/POL/BNB balances across configured EVM networks
- Shows every configured ERC-20/BEP-20 token balance for the hot-wallet address
- Optional fiat portfolio values using the same price service as invoices
- Public/read-only RPC references for BTC, DOGE, LTC, BCH, DASH and PIVX
- Clear separation between public blockchain RPC and private UTXO wallet RPC
- Existing ERC-20/TRC-20/SPL token payments and automatic sweeping remain supported
- GitHub Actions syntax/tests plus amd64/arm64 Docker builds and GHCR publishing

## Payment architecture

```text
Campaign / website
       |
       v
Create invoice
       |
       +-- native EVM / TRX / SOL --> unique temporary wallet
       +-- ERC20/TRC20/SPL token --> unique temporary wallet
       +-- BTC/DOGE/etc -----------> private daemon getnewaddress
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
       +-- token ----------> gas sponsor funds fee if needed, then sweep token
       +-- Lightning ------> already settled in LND
       |
       v
payment.swept
```

## Supported payment assets

### Native assets

| Asset | Adapter | Verification | Sweep |
|---|---|---|---|
| Ethereum / ETH | EVM | JSON-RPC | automatic |
| Polygon / POL | EVM | JSON-RPC | automatic |
| Base / ETH | EVM | JSON-RPC | automatic |
| BNB Smart Chain / BNB | EVM | JSON-RPC | automatic |
| TRON / TRX | TronWeb/full-node API | block scan | automatic |
| Solana / SOL | Solana JSON-RPC | signature/balance | automatic |
| Bitcoin / BTC | Core-compatible private wallet RPC | wallet RPC | automatic |
| Dogecoin / DOGE | Core-compatible private wallet RPC | wallet RPC | automatic |
| Litecoin / LTC | Core-compatible private wallet RPC | wallet RPC | automatic |
| Bitcoin Cash / BCH | Core-compatible private wallet RPC | wallet RPC | automatic |
| Dash / DASH | Core-compatible private wallet RPC | wallet RPC | automatic |
| PIVX / PIVX | Core-compatible private wallet RPC | wallet RPC | automatic |
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

Always verify contract and mint identifiers from the issuer before accepting mainnet funds.

## Pricing: RPC is not a fiat price feed

Blockchain RPC tells RPCPay about chain state: blocks, transactions, balances, receipts and smart-contract calls. A normal RPC node does **not** inherently know the fiat market price of BTC, ETH, PIVX, USDC, etc.

RPCPay therefore keeps **payment verification** and **market pricing** separate.

### NOWNodes Market Data

NOWNodes provides a dedicated market-data service separate from its blockchain node RPCs. RPCPay v0.4 can use its current-price endpoint:

```text
https://market-data.nownodes.io/api/v1/price
```

Configure:

```env
PRICE_PROVIDER=auto
NOWNODES_MARKET_API_BASE=https://market-data.nownodes.io/api/v1
NOWNODES_MARKET_API_KEY=your-key
```

`auto` prefers NOWNodes Market Data when a key is available, then falls back to CoinGecko if the NOWNodes quote fails.

Force NOWNodes only:

```env
PRICE_PROVIDER=nownodes
```

### CoinGecko fallback

```env
PRICE_PROVIDER=coingecko
PRICE_API_BASE=https://api.coingecko.com/api/v3
COINGECKO_API_KEY=
```

Neither NOWNodes Market Data nor CoinGecko processes the payment. They only provide fiat/crypto conversion rates used when an invoice is created.

## EVM Hot Wallet portfolio

Open:

```text
/admin -> Hot Wallet
```

Configure a single EVM address to view it across Ethereum, Base, Polygon and BNB Smart Chain:

```env
EVM_HOT_WALLET_ADDRESS=0xYourAddress
```

This is **watch-only mode**. RPCPay reads:

```text
eth_getBalance
ERC20 balanceOf(address) via eth_call
```

The dashboard shows the native balance plus every EVM token configured in `chains.json`, along with optional fiat values.

You can also configure a dedicated hot-wallet private key:

```env
EVM_HOT_WALLET_PRIVATE_KEY=0x...
```

RPCPay derives the public address and never returns the private key through the admin API. If both `EVM_HOT_WALLET_ADDRESS` and the private key are configured, they must match.

**The v0.4 dashboard is a balance/portfolio view; it does not expose a browser withdrawal/signing endpoint.** Keep private keys server-side.

### What "all EVM tokens" means

Standard EVM JSON-RPC does not have a universal method such as `eth_getAllTokensOwnedByAddress`. A node knows contract state, but it does not maintain a standardized wallet-token portfolio index.

Therefore the built-in dashboard safely shows:

```text
all native EVM balances
+
all ERC-20/BEP-20 assets configured in RPCPay
```

To discover arbitrary unknown token contracts automatically, RPCPay would need an indexer/provider token API or a large historical log scan. The dashboard deliberately does not pretend plain RPC can enumerate tokens it has never been told about.

Add another ERC-20/BEP-20 asset to `chains.json` and it automatically appears in the hot-wallet portfolio:

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

## Token verification and sweeping

### EVM tokens

RPCPay scans standard `Transfer(address,address,uint256)` logs using `eth_getLogs`, filtered by token contract and invoice destination address. After confirmation it estimates transfer gas and can top up the temporary wallet from a dedicated gas sponsor before sweeping tokens to the treasury.

### TRC-20

RPCPay validates the configured TRON token contract and standard transfer event, then can top up TRX for the sweep.

### Solana tokens

RPCPay checks token accounts owned by the invoice wallet for the configured mint and verifies transaction confirmation state. A Solana sponsor can pay transaction fees and ATA rent when required.

Gas sponsor configuration:

```env
ETH_GAS_SPONSOR_PRIVATE_KEY=
POLYGON_GAS_SPONSOR_PRIVATE_KEY=
BASE_GAS_SPONSOR_PRIVATE_KEY=
BNB_GAS_SPONSOR_PRIVATE_KEY=
TRON_GAS_SPONSOR_PRIVATE_KEY=
SOLANA_GAS_SPONSOR_SECRET_KEY=
```

Use dedicated low-balance sponsor wallets. Never use your cold/treasury private keys.

## RPC providers and failover

EVM/TRON/Solana assets can have multiple active endpoints. RPCPay rotates healthy nodes and backs off failing endpoints.

Example PublicNode defaults:

```text
Ethereum  https://ethereum-rpc.publicnode.com
Polygon   https://polygon-bor-rpc.publicnode.com
Base      https://base-rpc.publicnode.com
BNB       https://bsc-rpc.publicnode.com
TRON      https://tron-rpc.publicnode.com
Solana    https://solana-rpc.publicnode.com
```

Optional NOWNodes endpoints/API key remain server-side:

```env
NOWNODES_API_KEY=
ETH_NOWNODES_RPC_URL=
POLYGON_NOWNODES_RPC_URL=
BASE_NOWNODES_RPC_URL=
BNB_NOWNODES_RPC_URL=
TRON_NOWNODES_RPC_URL=
SOLANA_NOWNODES_RPC_URL=
```

## BTC / DOGE / LTC / BCH / DASH / PIVX public RPC references

The config now records useful **network/read-only RPC references** separately from the private wallet RPC that RPCPay uses for custody.

```text
BTC   https://bitcoin-rpc.publicnode.com
      https://public-btc.nownodes.io
      https://btc.nownodes.io

DOGE  https://doge.nownodes.io
LTC   https://ltc.nownodes.io
BCH   https://bch.nownodes.io

DASH  https://dash-rpc.publicnode.com
      https://dash.nownodes.io

PIVX  https://pivx-rpc.publicnode.com
      https://pivx.nownodes.io
```

These appear in `/admin -> Chains & RPC` as **Public/read-only RPC references**.

### Why they do not replace the private wallet RPC yet

The current Bitcoin-family payment adapter allocates and spends through wallet methods:

```text
getnewaddress
listreceivedbyaddress
sendtoaddress
```

Public/shared full nodes are appropriate for blockchain reads and, where enabled, broadcasting an already-signed raw transaction. They must not contain RPCPay's private wallet for you.

So the active wallet fields remain:

```env
BTC_RPC_URL=
BTC_RPC_USER=
BTC_RPC_PASSWORD=
DOGE_RPC_URL=
DOGE_RPC_USER=
DOGE_RPC_PASSWORD=
LTC_RPC_URL=
LTC_RPC_USER=
LTC_RPC_PASSWORD=
BCH_RPC_URL=
BCH_RPC_USER=
BCH_RPC_PASSWORD=
DASH_RPC_URL=
DASH_RPC_USER=
DASH_RPC_PASSWORD=
PIVX_RPC_URL=
PIVX_RPC_USER=
PIVX_RPC_PASSWORD=
```

A future UTXO adapter can generate/sign locally and use PublicNode/NOWNodes only for blockchain reads and `sendrawtransaction`; that is a different custody model from the current daemon-wallet adapter.

## Bitcoin Lightning

Lightning uses your own LND node:

```env
LND_REST_URL=https://lnd:8080
LND_MACAROON_HEX=...
```

Use a least-privileged macaroon and do not expose LND REST directly to the public internet.

## Install

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

## GitHub-built Docker image

The workflow publishes multi-architecture images after changes land on `main`:

```bash
docker pull ghcr.io/nekosuneprojects/rpcpay-platform:latest
```

Platforms:

```text
linux/amd64
linux/arm64
```

`.github/workflows/docker.yml` runs Node 24 dependency installation, syntax checks, unit tests and Docker Buildx before publishing to GHCR.

## Admin page

`/admin` provides:

- Overview of recent invoices and sweep status
- **Hot Wallet** EVM portfolio and fiat values
- Campaign creation/management
- Owner/treasury addresses
- Asset enable/disable controls
- Auto-sweep controls
- Active RPC failover configuration
- Read-only UTXO public RPC references

## Campaign accounting

A campaign can be denominated in GBP, USD, EUR or another supported quote currency.

Example:

```text
Goal: GBP 2,000
Donation: GBP 25
Payment asset: USDC on Base
```

RPCPay obtains a price at invoice creation, locks the required crypto amount into the invoice, and records the original GBP 25 contribution. Later crypto market movement does not rewrite historical campaign totals.

## Public API

List payment assets:

```http
GET /api/public/chains
```

Create a campaign invoice:

```http
POST /api/public/campaigns/server-costs/invoices
Content-Type: application/json

{
  "chainId": "base-usdc",
  "fiatAmount": "25.00"
}
```

Poll:

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

Events:

```text
payment.detected
payment.confirmed
payment.invalidated
payment.swept
invoice.expired
```

Signatures:

```text
HMAC-SHA256(WEBHOOK_SECRET, timestamp + "." + raw_request_body)
```

## Custody and security

For generated EVM, TRON and Solana invoice wallets, RPCPay encrypts private keys with AES-256-GCM before storing them in SQLite.

Back up both the SQLite database and `WALLET_ENCRYPTION_KEY`. Losing either before funds are swept can make temporary-wallet funds unrecoverable.

Also:

- use HTTPS in production
- protect `/admin`
- never expose private UTXO wallet RPC ports publicly
- never commit `.env`
- use dedicated low-balance gas sponsor wallets
- avoid storing a hot-wallet private key unless the server actually needs signing capability
- test tokens with tiny values/testnets before real payments
- verify token contracts/mints from their issuers
- treat fee-on-transfer/rebasing/reflection tokens as non-standard until explicitly tested

## Current limitations

- The EVM Hot Wallet view enumerates configured ERC-20/BEP-20 assets, not unknown token contracts.
- The Hot Wallet page is a portfolio/balance view; browser withdrawals are intentionally not exposed in v0.4.
- Generic token support assumes standard transfer semantics.
- Partial token transfers are not accumulated across multiple transactions yet.
- TRC-20 gas top-up remains configurable rather than dynamically purchasing/delegating Energy.
- Bitcoin-family payments still use your private daemon wallet; local HD signing + public-RPC broadcasting is a separate future adapter.
- Lightning currently targets LND.
- This is custodial payment infrastructure. Review and test before using real funds.
