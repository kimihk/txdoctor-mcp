# txdoctor-mcp — Solana transaction failure diagnostics MCP server.
# Zero-dependency Node server; data.json is embedded in the image.
FROM node:20-alpine

WORKDIR /app

COPY package.json index.mjs data.json ./

# Run as a non-root user.
USER node

ENTRYPOINT ["node", "index.mjs"]
