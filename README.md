# Hyperledger Identus Edge Wallet

**Browser-Based Self-Sovereign Identity (SSI) Wallet**

A production-ready edge wallet implementation built on Hyperledger Identus SDK v6.6.0 for managing decentralized identities (DIDs) and verifiable credentials (VCs).

## Features

- **DIDComm Messaging**: Encrypted peer-to-peer communication
- **Verifiable Credentials**: Issue, receive, store, and verify W3C VCs
- **PRISM DIDs**: Create and manage blockchain-anchored identities
- **Peer DIDs**: Instant DIDComm connections without blockchain
- **StatusList2021**: W3C-compliant credential revocation
- **X25519 Encryption**: Client-side content encryption
- **Enterprise Mode**: Connect to Cloud Agent for company-managed credentials

## Project Structure

```
identus-edge-wallet/
├── wallet/           # Alice Wallet (Next.js application)
│   ├── src/
│   │   ├── components/   # React components
│   │   ├── pages/        # Next.js pages
│   │   ├── actions/      # Redux actions
│   │   ├── reducers/     # Redux state management
│   │   └── utils/        # Utility modules
│   └── public/           # Static assets
├── sdk-src/          # Hyperledger Identus SDK (modified)
│   ├── apollo/       # Cryptographic operations
│   ├── castor/       # DID operations
│   ├── mercury/      # DIDComm messaging
│   ├── pluto/        # IndexedDB storage
│   ├── pollux/       # Verifiable credentials
│   └── edge-agent/   # Agent coordination
├── package.json      # SDK dependencies
└── tsconfig.json     # TypeScript configuration
```

## Prerequisites

- Node.js 18+
- Yarn package manager
- Modern browser with IndexedDB support

## Quick Start

```bash
# Install dependencies
cd wallet
yarn install

# Start development server
yarn dev

# Access wallet at http://localhost:3001
```

## Key Components

### Wallet Application (`wallet/`)

| Component | Purpose |
|-----------|---------|
| `OOB.tsx` | Out-of-band invitation handling |
| `ConnectToCA.tsx` | Certification Authority connection |
| `Chat.tsx` | DIDComm messaging with encryption |
| `Credentials.tsx` | Credential display and management |
| `Verify.tsx` | Verifiable presentation submission |

### SDK Modifications (`sdk-src/`)

Custom fixes applied to Hyperledger Identus SDK:

- Graceful attachment handling in `Message.ts`
- PRISM DID binding in `HandleOfferCredential.ts`
- Deferred WALLET_READY signal for Pluto key fallback

## Configuration

Each wallet instance requires unique configuration in `reducers/app.ts`:

```typescript
const getWalletConfig = () => ({
    walletId: 'alice',
    walletName: 'Alice Wallet',
    dbName: 'identus-wallet-alice',
    storagePrefix: 'wallet-alice-'
});
```

## Related Repository

**Server-Side Infrastructure**: [identus-ssi-infrastructure](https://github.com/janskor-cz/identus-ssi-infrastructure)

Contains Cloud Agent, Certification Authority, Company Admin Portal, and Docker configurations.

## Documentation

- [Wallet Documentation](wallet/CLAUDE.md) - Comprehensive implementation details
- [Hyperledger Identus](https://docs.atalaprism.io/) - Official SDK documentation

## License

Apache License 2.0

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make changes and test
4. Submit pull request
