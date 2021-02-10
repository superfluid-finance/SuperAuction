const SuperAuction = artifacts.require("SuperAuction");

module.exports = async function (callback, argv) {

    try {

        //Goerli V1 info
        const host = "0x22ff293e14F1EC3A09B137e9e06084AFd63adDF9";
        const cfa = "0xEd6BcbF6907D4feEEe8a8875543249bEa9D308E8";
        const fDAIx = "0xF2d68898557cCb2Cf4C10c3Ef2B034b2a69DAD00";
        const NFT = "0x232412F72cB4e679Df8eDF7dbCA62A1d3854f61e";

        const app = await SuperAuction.new(
            host,
            cfa,
            fDAIx,
            NFT,
            1,
            86400,
            10
          );

        console.log("App deployed at", app.address);
    } catch (err) {
        console.log(err);
    }
}
