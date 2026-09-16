#!/usr/bin/env node

import { generateAccessToken } from './auth.mjs';

function usage() {
  return `SPARK authentication helper

Usage:
  node modules/transport/src/auth-cli.mjs generate [--json]

Commands:
  generate   Generate one 256-bit per-instance bearer/API key.

The raw token is printed once. SPARK stores only its SHA-256 digest.
`;
}

function main() {
  const args = process.argv.slice(2);
  const command = args.shift();
  const json = args.includes('--json');
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(usage());
    return;
  }
  if (command !== 'generate' || args.some((arg) => arg !== '--json')) {
    process.stderr.write(usage());
    process.exitCode = 2;
    return;
  }

  const generated = generateAccessToken();
  const result = {
    token: generated.token,
    sha256: generated.sha256,
    entropyBits: generated.entropyBits,
    config: {
      transport: {
        auth: {
          mode: 'bearer',
          bearerTokenSha256: generated.sha256,
        },
      },
    },
  };
  if (json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }

  process.stdout.write('SPARK Access Key - show/copy once; do not commit it:\n');
  process.stdout.write(`${generated.token}\n\n`);
  process.stdout.write('SHA-256 digest for transport.auth.bearerTokenSha256:\n');
  process.stdout.write(`${generated.sha256}\n\n`);
  process.stdout.write(`Entropy: ${generated.entropyBits} bits (Node.js crypto.randomBytes / OS CSPRNG)\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`SPARK auth: ${error?.message ?? error}\n`);
  process.exitCode = 1;
}
