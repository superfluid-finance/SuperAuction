const HDWalletProvider = require("@truffle/hdwallet-provider");
require("dotenv").config();


function createProviderForOpenEthereum(url) {
    let provider;
    const Web3WsProvider = require("web3-providers-ws");
    if (url.startsWith("ws:") || url.startsWith("wss:")) {
        provider = new Web3WsProvider(url);
        // apply the skipCache hack
        const origSend = provider.__proto__.send;
        provider.__proto__.send = function (payload, callback) {
            delete payload.skipCache;
            origSend.call(provider, payload, callback);
        };
    } else {
        // let hdwallet provider handle the url directly
        provider = url;
    }
    return provider;
}

module.exports = {
  plugins: [
    "solidity-coverage",
    "truffle-plugin-verify"
  ],

  networks: {

    mainnet: {
      provider: () =>
      new HDWalletProvider(
        process.env.MAINNET_MNEMONIC,
        process.env.MAINNET_PROVIDER_URL,
        0, //address_index
        10, // num_addresses
        true // shareNonce
      ),
      network_id: 1, // mainnet's id
      gas: 8e6,
      gasPrice: +process.env.MAINNET_GAS_PRICE || 1e9, // default 1 gwei
      //confirmations: 6, // # of confs to wait between deployments. (default: 0)
      timeoutBlocks: 50, // # of blocks before a deployment times out  (minimum/default: 50)
      skipDryRun: false, // Skip dry run before migrations? (default: false for public nets )
    },


    goerli: {
      provider: () => new HDWalletProvider(
        process.env.GOERLI_MNEMONIC,
        process.env.GOERLI_PROVIDER_URL,
        0, //address_index
        10, // num_addresses
        true // shareNonce
      ),
      network_id: 5, // Goerli's id
      gas: 8e6,
      gasPrice: +process.env.GOERLI_GAS_PRICE || 2e9, // 100 GWEI, goerli is busy!
      confirmations: 6, // # of confs to wait between deployments. (default: 0)
      timeoutBlocks: 50, // # of blocks before a deployment times out  (minimum/default: 50)
      skipDryRun: false // Skip dry run before migrations? (default: false for public nets )
    },

    matic: {
            provider: () => {
                return new HDWalletProvider(
                    process.env.MATIC_MNEMONIC,
                    createProviderForOpenEthereum(
                        process.env.MATIC_PROVIDER_URL
                    ),
                    0, //address_index
                    10, // num_addresses
                    true // shareNonce
                );
            },
            network_id: 137,
            gas: 20e6,
            gasPrice: +process.env.MATIC_GAS_PRICE || 1e9,
            confirmations: 3, // # of confs to wait between deployments. (default: 0)
            timeoutBlocks: 50, // # of blocks before a deployment times out  (minimum/default: 50)
            skipDryRun: false, // Skip dry run before migrations? (default: false for public nets )
        },

    mumbai: {
      provider: () =>
      new HDWalletProvider(
        process.env.MUMBAI_MNEMONIC,
        process.env.MUMBAI_PROVIDER_URL,
        0, //address_index
        10, // num_addresses
        true // shareNonce
      ),
      network_id: 80001,
      gas: 8e6,
      gasPrice: +process.env.MUMBAI_GAS_PRICE || 1e9, // default 1 gwei
      //confirmations: 6, // # of confs to wait between deployments. (default: 0)
      timeoutBlocks: 50, // # of blocks before a deployment times out  (minimum/default: 50)
      skipDryRun: false, // Skip dry run before migrations? (default: false for public nets )
    },

    rinkeby: {
      provider: () =>
      new HDWalletProvider(
        process.env.RINKEBY_MNEMONIC,
        process.env.RINKEBY_PROVIDER_URL,
        0, //address_index
        10, // num_addresses
        true // shareNonce
      ),
      network_id: 4,
      gas: 8e6,
      gasPrice: 1e9, // default 1 gwei
      //confirmations: 6, // # of confs to wait between deployments. (default: 0)
      timeoutBlocks: 50, // # of blocks before a deployment times out  (minimum/default: 50)
      skipDryRun: false, // Skip dry run before migrations? (default: false for public nets )
    },

    coverage: {
      host: "localhost",
      network_id: "*",
      port: 8555, // <-- If you change this, also set the port option in .solcover.js.
      gas: 0xfffffffffff, // <-- Use this high gas value
      gasPrice: 0x01 // <-- Use this low gas price
    },
  ganache: {
      host: "localhost",
      port: 8545,
      network_id: "*"
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
       settings: {          // See the solidity docs for advice about optimization and evmVersion
        optimizer: {
          enabled: false,
          runs: 200
        },
      //  evmVersion: "byzantium"
       }
    },
  },
  api_keys: {
    etherscan: process.env.ETHERSCAN_API_KEY
  }
};
