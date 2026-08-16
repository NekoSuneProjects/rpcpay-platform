# RPCPay Platform v0.2.0

A lightweight self-hosted cryptocurrency donation/payment gateway focused on direct node/RPC verification instead of a large ecommerce stack.

## What v0.2 adds

- Public campaign pages with fundraising goals and progress
- Admin dashboard at `/admin`
- Campaign creation and management
- Per-chain owner/treasury wallet configuration
- Multiple RPC endpoints per chain with automatic failover
- One deposit address/wallet per on-chain invoice
- Automatic confirmation tracking
- Automatic sweep to the owner wallet after confirmation
- Network fee/gas reserve handling and sweep records
- Signed payment webhooks
- Fiat-denominated campaigns with crypto quote conversion
- Docker deployment

## Included chain adapters

| Chain | Adapter | Address creation | Verification | Sweep |
|---|---|---|---|---|
| Ethereum | EVM | Local generated wallet | JSON-RPC block scan | Automatic |
| Polygon PoS | EVM | Local generated wallet | JSON-RPC block scan | Automatic |
| Base | EVM | Local generated wallet | JSON-RPC block scan | Automatic |
| BNB Smart Chain | EVM | Local generated wallet | JSON-RPC block scan | Automatic |
| TRON / TRX | TronWeb | Local generated wallet | Full-node block scan | Automatic |
| Solana / SOL | Solana RPC | Local generated keypair | Address/signature verification | Automatic |
| Bitcoin | Bitcoin Core-style wallet RPC | `getnewaddress` | wallet RPC | Automatic |
| Dogecoin | Bitcoin-style wallet RPC | `getnewaddress` | wallet RPC | Automatic |
| Litecoin | Bitcoin-style wallet RPC | `getnewaddress` | wallet RPC | Automatic |
| Bitcoin Cash | Bitcoin-style wallet RPC | `getnewaddress` | wallet RPC | Automatic |
| Dash | Bitcoin-style wallet RPC | `getnewaddress` | wallet RPC | Automatic |
| PIVX | Bitcoin-style wallet RPC | `getnewaddress` | wallet RPC | Automatic |
| Bitcoin Lightning | LND REST | BOLT11 invoice | LND invoice state | Funds stay in LND wallet |

Bitcoin-family compatibility depends on the daemon exposing compatible wallet methods. If a fork changes the RPC method names or arguments, make a small adapter/config adjustment.

## Payment flow

```text
Campaign page
    |
    +--> Create invoice
            |
            +--> ETH / Polygon / Base / BNB -> generate temporary EVM wallet
            +--> TRX                        -> generate temporary TRON wallet
            +--> SOL                        -> generate temporary Solana wallet
            +--> BTC/DOGE/LTC/BCH/DASH/PIVX -> daemon getnewaddress
            +--> Lightning                  -> LND AddInvoice
                    |
                    v
              Customer pays
                    |
                    v
            RPCPay verifies payment
                    |
             confirmations reached
                    |
                    v
           payment.confirmed webhook
                    |
                    v
       Sweep temporary balance to
         configured owner wallet
                    |
                    v
            payment.swept webhook
```

## Important custody model

For EVM, TRON and Solana, the application generates an invoice wallet locally. The private key is encrypted with AES-256-GCM before being stored in SQLite. It is never returned from a public API.

**Back up both the SQLite database and `WALLET_ENCRYPTION_KEY`. If either is lost before funds are swept, those temporary wallet funds can become unrecoverable.**

Bitcoin/Dogecoin/PIVX/Litecoin/Dash/BCH addresses are owned by their daemon wallet instead. RPCPay never needs their private keys.

Lightning invoices are created on your LND node, so settled satoshis already belong to that node and no extra sweep is performed.

## Install

```bash
cp .env.example .env
cp config/chains.example.json config/chains.json
```

Generate secrets:

```bash
openssl rand -hex 32
```

Use independent random values for:

```env
API_KEY=
WEBHOOK_SECRET=
WALLET_ENCRYPTION_KEY=
ADMIN_SESSION_SECRET=
ADMIN_PASSWORD=
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

For HTTPS production deployments, place RPCPay behind Caddy, Traefik, nginx, Cloudflare Tunnel, or another TLS reverse proxy and set:

```env
COOKIE_SECURE=true
```

## Admin page

The admin UI lets you:

- Create campaigns
- Set the campaign goal and currency
- Set each chain's owner wallet
- Enable/disable chains
- Enable/disable automatic sweeping
- Add multiple RPC endpoints, one per line
- View recent invoice/payment status

RPC URLs changed in the admin panel are saved in SQLite and take effect without restarting the app.

## Campaign accounting

A campaign can use GBP, USD, EUR or another CoinGecko-supported quote currency.

Example:

```text
Goal: GBP 2,000
Donation: GBP 25
Payment network: SOL
```

RPCPay gets the current SOL price when the invoice is created, locks the required SOL amount into that invoice, and stores the GBP 25 contribution. When the transaction is confirmed, the campaign progress increases by GBP 25 rather than changing later with the SOL market price.

The price service is configurable:

```env
PRICE_API_BASE=https://api.coingecko.com/api/v3
COINGECKO_API_KEY=
```

## Multiple RPC nodes / failover

Each chain can have multiple endpoints:

```text
https://rpc-1.example
https://rpc-2.example
https://rpc-3.example
```

RPCPay rotates/fails over when an RPC request fails. For production, use at least two providers or one provider plus your own node where practical.

## Bitcoin-family node example

Keep daemon RPC private. Do not publish it on the internet.

Example Bitcoin Core configuration:

```ini
server=1
rpcbind=0.0.0.0
rpcallowip=172.16.0.0/12
rpcuser=rpcpay
rpcpassword=CHANGE_THIS
```

Then configure RPCPay:

```env
BTC_RPC_URL=http://bitcoin:8332
BTC_RPC_USER=rpcpay
BTC_RPC_PASSWORD=CHANGE_THIS
```

Enable Bitcoin in `/admin` and set the owner BTC wallet address.

The same adapter is intended for compatible daemons such as Dogecoin, Litecoin, Dash and PIVX.

## LND Lightning

Configure the REST endpoint and macaroon:

```env
LND_REST_URL=https://lnd:8080
LND_MACAROON_HEX=...
```

Use the least-privileged macaroon that can create/read invoices. Avoid exposing LND REST directly to the public internet.

## Public website API

List campaigns:

```http
GET /api/public/campaigns
```

List available chains:

```http
GET /api/public/chains
```

Create a campaign invoice:

```http
POST /api/public/campaigns/server-costs/invoices
Content-Type: application/json

{
  "chainId": "polygon",
  "fiatAmount": "25.00"
}
```

Example response:

```json
{
  "id": "inv_...",
  "chainId": "polygon",
  "symbol": "POL",
  "amount": "...",
  "address": "0x...",
  "paymentRequest": null,
  "status": "pending",
  "confirmations": 0,
  "confirmationsRequired": 64,
  "fiatAmount": "25.00",
  "fiatCurrency": "GBP"
}
```

Poll status:

```http
GET /api/public/invoices/inv_...
```

## Server-to-server API

Use the `x-api-key` header:

```bash
curl -X POST http://127.0.0.1:8080/v1/invoices \
  -H "x-api-key: $API_KEY" \
  -H "content-type: application/json" \
  -d '{
    "chainId": "pivx",
    "amount": "25.5",
    "webhookUrl": "https://example.com/payment-webhook"
  }'
```

## Webhooks

Events include:

```text
payment.detected
payment.confirmed
payment.invalidated
payment.swept
invoice.expired
```

Headers:

```text
x-rpcpay-event
x-rpcpay-timestamp
x-rpcpay-signature
```

Signature input:

```text
HMAC-SHA256(WEBHOOK_SECRET, timestamp + "." + raw_request_body)
```

## Adding your own Bitcoin/Dogecoin-like blockchain

Add a chain to `config/chains.json`:

```json
{
  "id": "nekocoin",
  "name": "Neko Coin",
  "symbol": "NEKO",
  "adapter": "bitcoin-rpc",
  "rpcUrls": ["http://nekocoin:9332"],
  "rpcUser": "${NEKO_RPC_USER}",
  "rpcPassword": "${NEKO_RPC_PASSWORD}",
  "decimals": 8,
  "confirmations": 6,
  "addressMode": "rpc-wallet",
  "priceId": "",
  "enabled": false,
  "sweepReserveAtomic": "10000"
}
```

For a community coin that is not listed by the price provider, server-to-server invoices can still use a direct crypto `amount`. A custom/manual price adapter can be added later if it needs to contribute to a fiat campaign goal.

## Public RPC notes

Public RPCs are useful for testing and low-volume operation, but they are not equivalent to owning a wallet node.

- Polygon documents multiple free public endpoints.
- Base provides an official public mainnet endpoint but explicitly calls it rate-limited/not for production.
- BNB Chain publishes public BSC endpoints.
- Solana publishes public mainnet/devnet/testnet RPC endpoints but explicitly warns that public RPC is not intended for production applications.
- TRON provides TronGrid APIs; an API key/private provider is recommended for a real payment service.
- Bitcoin-family wallet RPCs should normally be your own private daemon. Do not expect a public RPC provider to expose `getnewaddress` or wallet signing safely.
- Lightning requires your own receiving Lightning node (LND in this version) with channel/inbound-liquidity considerations.

## Validation performed for this build

- JavaScript syntax checks across the server and all adapters
- 10/10 unit tests passing
- Mock EVM payment detection
- Mock PIVX/Bitcoin-style address generation + payment detection
- SQLite persistence test
- Webhook HMAC test
- Live local smoke test of health endpoint, public UI, admin UI/login, campaign creation, and public campaign API

## Current limitations

- Native assets only for EVM/TRON/Solana in v0.2. ERC-20/BEP-20/TRC-20/SPL token adapters are not included yet.
- EVM automatic sweeping depends on enough received native coin to cover gas; RPCPay reserves gas from the deposit balance.
- TRON reserves configurable TRX for bandwidth/activation/network costs; actual resource usage can differ.
- Bitcoin-family sweeping uses the daemon wallet and may spend pooled wallet UTXOs rather than the exact invoice UTXO.
- LND is the Lightning implementation included right now; Core Lightning can be added as another adapter.
- This is custodial payment software. Test on testnet/devnet/regtest before accepting real money and protect backups, RPC credentials, macaroons, and the wallet encryption key.
