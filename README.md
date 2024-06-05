# gasless-transactions
Gasless Transactions on Lamina1

This code follows the example `Usage with Typescript ethers library` from ava cloud: https://app.avacloud.io/integrations/gasless-transactions/about/

## Installation

```bash
yarn
```

## Usage

Copy the `.env.example` file to `.env` and fill in the user private key. All the other values are already populated for the Lamina1 Testnet on Fuji.

Then run the script with:
```bash
yarn ts-node -r dotenv/config src/increment.ts
```

This will send a transaction that interacts with the example contract `GaslessCounter.sol` on the Lamina1 Testnet, deployed at: `0x426350d68Ae2102E41a7E294F2CB461aA23cEeD8`.
