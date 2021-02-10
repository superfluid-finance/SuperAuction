const HDWalletProvider = require("@truffle/hdwallet-provider");
require("dotenv").config();

module.exports = {
  plugins: [
    "solidity-coverage",
    "truffle-plugin-verify"
  ],

  networks: {

    goerli: {
      provider: () => new HDWalletProvider(
        process.env.GOERLI_MNEMONIC,
        process.env.GOERLI_PROVIDER_URL
      ),
      network_id: 5, // Goerli's id
      gas: 8e6,
      gasPrice: +process.env.GOERLI_GAS_PRICE || 100e9, // 100 GWEI, goerli is busy!
      confirmations: 6, // # of confs to wait between deployments. (default: 0)
      timeoutBlocks: 50, // # of blocks before a deployment times out  (minimum/default: 50)
      skipDryRun: false // Skip dry run before migrations? (default: false for public nets )
    },

    coverage: {
      host: "localhost",
      network_id: "*",
      port: 8555, // <-- If you change this, also set the port option in .solcover.js.
      gas: 0xfffffffffff, // <-- Use this high gas value
      gasPrice: 0x01 // <-- Use this low gas price
    },
  },

  // Set default mocha options here, use special reporters etc.
  mocha: {
    // timeout: 100000
  },

  // Configure your compilers
  compilers: {
    solc: {
      version: "0.7.6",    // Fetch exact version from solc-bin (default: truffle's version)
      // docker: true,        // Use "0.5.1" you've installed locally with docker (default: false)
      // settings: {          // See the solidity docs for advice about optimization and evmVersion
      //  optimizer: {
      //    enabled: false,
      //    runs: 200
      //  },
      //  evmVersion: "byzantium"
      // }
    },
  },
  api_keys: {
    etherscan: process.env.ETHERSCAN_API_KEY
  }
};
