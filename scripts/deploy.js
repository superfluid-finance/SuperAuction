const {
    web3tx
} = require("@decentral.ee/web3-helpers");
const SuperfluidSDK = require("@superfluid-finance/ethereum-contracts");
const Auction = artifacts.require("Auction");

module.exports = async function (callback, argv) {
    const errorHandler = err => { if (err) throw err; };

    try {
        global.web3 = web3;

        const version = process.env.RELEASE_VERSION || "test";
        console.log("release version:", version);

        this.framework = new SuperfluidSDK.Framework({
            version: version,
            web3Provider: web3,
            tokens: "fDAI",
            chainId: 5
        });
        await this.framework.initialize();

        const app = await web3tx(SuperAuction.new, "Deploy SuperAuction")(
            sf.host.address,
            sf.agreements.cfa.address,
            sf.tokens.fDAIx.address,
            86400,
            10
          );

        console.log("App deployed at", app.address);
        callback();
    } catch (err) {
        callback(err);
    }
}