# txdoctor-mcp

**Solana transaction failure diagnostics for AI agents.**

An MCP (Model Context Protocol) server that decodes Solana program errors —
including the cross-program collisions that no single project's docs explain:
code `0x1773` means one thing in Jupiter, another in Raydium CLMM, another in
Orca, and five more meanings elsewhere. This server returns **all** of them and
tells you how to identify which program raised yours.

Data source & web version: **[txdoctor.app](https://txdoctor.app)**

## Coverage

202 error entries across 12 programs:

| Program | Codes |
|---|---|
| Jupiter / Jupiter v4 | swap aggregation |
| Raydium CPMM / CLMM / AMM v4 | swap, liquidity, limit orders |
| Raydium LaunchLab | launchpad lifecycle: funding, graduation, vesting |
| Orca Whirlpools | concentrated liquidity |
| Meteora DLMM / Dynamic AMM | bin liquidity, launch pools |
| pump.fun | bonding curve, graduation |
| SPL Token / Token-2022 | token program errors |

Error definitions are compiled from each program's official source code and
IDLs — not guessed.

## Tools

### `lookup_error`
Look up a code by hex or decimal: `"0x1773"` or `"6003"`.
Returns every program's meaning, with likely causes, fixes and an example log
line for each — plus identification guidance when the code is contested.

### `decode_log`
Paste a transaction log. Extracts the failed program ID and error code, then
returns the exact meaning for that program, and the collision map when the
program is unknown.

### `list_programs`
List covered programs and code counts.

## Setup

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "txdoctor": {
      "command": "npx",
      "args": ["-y", "txdoctor-mcp"]
    }
  }
}
```

### Any MCP client (stdio)

```bash
npx -y txdoctor-mcp
```

Zero dependencies. Node ≥ 18. Data is embedded and works fully offline.

## Example

```json
{ "tool": "lookup_error", "arguments": { "code": "0x1e" } }
```

→ `0x1e` (decimal 30) is claimed by 3 programs with 3 different meanings:
transfer fee exceeds maximum in SPL Token / Token-2022, exceeded slippage in
Raydium AMM v4 — with the log line and fixes for each.

## Web version

[txdoctor.app](https://txdoctor.app) has the full browsable catalogue, a
[cross-program collision index](https://txdoctor.app/cross-program-error-codes/),
and per-code pages like
[0x1773](https://txdoctor.app/code/0x1773/) (8 programs, 8 meanings).

## License

MIT
