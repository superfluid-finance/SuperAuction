const Viewer = artifacts.require("SuperAuctionViewer");

module.exports = async function (callback, argv) {

    try {
        const app = await Viewer.new();
        console.log("App deployed at", app.address);
    } catch (err) {
        callback(err);
    }
}
