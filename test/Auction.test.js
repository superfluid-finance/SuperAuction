const { web3tx, toWad, toBN } = require("@decentral.ee/web3-helpers");
const { expectRevert } = require("@openzeppelin/test-helpers");
const deployFramework = require("@superfluid-finance/ethereum-contracts/scripts/deploy-framework");
const deployTestToken = require("@superfluid-finance/ethereum-contracts/scripts/deploy-test-token");
const deploySuperToken = require("@superfluid-finance/ethereum-contracts/scripts/deploy-super-token");
const SuperfluidSDK = require("@superfluid-finance/js-sdk");
const SuperAuction = artifacts.require("SuperAuction");

contract("SuperAuction", accounts => {
    const errorHandler = err => {
        if (err) throw err;
    };

    accounts = accounts.slice(0, 4);
    const [admin, bob, carol, dan] = accounts;

    let sf;
    let dai;
    let daix;
    let app;

    beforeEach(async function() {
        const web3Provider = web3.currentProvider;

        await deployFramework(errorHandler, { from: admin });
        await deployTestToken(errorHandler, [":", "fDAI"], {
            web3Provider,
            from: admin
        });
        await deploySuperToken(errorHandler, [":", "fDAI"], {
            web3Provider,
            from: admin
        });

        sf = new SuperfluidSDK.Framework({
            web3Provider,
            tokens: ["fDAI"]
        });
        await sf.initialize();
        daix = sf.tokens.fDAIx;

        if (!dai) {
            const daiAddress = await sf.tokens.fDAI.address;
            dai = await sf.contracts.TestToken.at(daiAddress);
            for (let i = 0; i < accounts.length; ++i) {
                await web3tx(dai.mint, `Account ${i} mints many dai`)(
                    accounts[i],
                    toWad(10000000),
                    { from: accounts[i] }
                );
                await web3tx(
                    dai.approve,
                    `Account ${i} approves daix`
                )(daix.address, toWad(100), { from: accounts[i] });

                await web3tx(
                    daix.upgrade, `Account ${i} upgrades many DAIx`)(
                        toWad(100), { from: accounts[i]
                        }
                );
            }
        }

        app = await web3tx(SuperAuction.new, "Deploy SuperAuction")(
            sf.host.address,
            sf.agreements.cfa.address,
            daix.address,
            86400
        );

    });

    async function openStream(from, to, flowRate, userData) {
        return await sf.host.callAgreement(
            sf.agreements.cfa.address,
            sf.agreements.cfa.contract.methods
                .createFlow(
                    daix.address,
                    to.toString(),
                    flowRate.toString(),
                    userData
                )
                .encodeABI(),
            "0x", // user data
            {
                from: from.toString()
            }
        );
    };

    async function getListTop100() {
        return await app.getBiddersAddresses(0, 100);
    }

    it("Case #1 - Bob joins new SuperAuction", async () => {
        await sf.cfa.createFlow({
            superToken: daix.address,
            sender: bob,
            receiver: app.address,
            flowRate: "10000000"
        });

        const bobFlowInfo = await sf.cfa.getFlow({
            superToken: daix.address,
            sender: bob,
            receiver: app.address
        });
        console.log(
            `Bob -> Auction flow : ${bobFlowInfo.flowRate.toString()}`
        );

        const winner = await app.winner.call();
        const winnerFlowRate = await app.winnerFlowRate.call();
        assert.equal(winner, bob, "Bob should be the winner");
        assert.equal(winnerFlowRate.toString(), bobFlowInfo.flowRate.toString(), "Bob should have the correct flowRate as winner");
        assert.equal(bob, (await getListTop100())[0], "Bob not in fist place on listTop");
    });

    it("Case #2 - Joining running SuperAuction", async () => {
        await sf.cfa.createFlow({
            superToken: daix.address,
            sender: bob,
            receiver: app.address,
            flowRate: "10000000"
        });

        await sf.cfa.createFlow({
            superToken: daix.address,
            sender: carol,
            receiver: app.address,
            flowRate: "1100000001"
        });


        const bobFlowInfo = await sf.cfa.getFlow({
            superToken: daix.address,
            sender: bob,
            receiver: app.address
        });

        const carolFlowInfo = await sf.cfa.getFlow({
            superToken: daix.address,
            sender: carol,
            receiver: app.address
        });
        console.log(
            `Bob -> Auction flow : ${bobFlowInfo.flowRate.toString()}`
        );
        console.log(
            `Carol -> Auction flow : ${carolFlowInfo.flowRate.toString()}`
        );

        let winner = await app.winner.call();
        let winnerFlowRate = await app.winnerFlowRate.call();
        assert.equal(winner, carol, "Carol should be the winner");
        assert.equal(winnerFlowRate.toString(), carolFlowInfo.flowRate.toString(), "Carol should have the correct flowRate as winner");
        assert.equal(carol, (await getListTop100())[0], "Carol not in fist place on listTop");
        assert.equal(bob, (await getListTop100())[1], "Bob not in second place on listTop");


        await sf.cfa.createFlow({
            superToken: daix.address,
            sender: dan,
            receiver: app.address,
            flowRate: "52100000000"
        });

        const danFlowInfo = await sf.cfa.getFlow({
            superToken: daix.address,
            sender: dan,
            receiver: app.address
        });
        console.log(
            `Dan -> Auction flow : ${danFlowInfo.flowRate.toString()}`
        );
        winner = await app.winner.call();
        winnerFlowRate = await app.winnerFlowRate.call();

        assert.equal(winner, dan, "Dan should be the winner");
        assert.equal(winnerFlowRate.toString(), danFlowInfo.flowRate.toString(), "Dan should have the correct flowRate as winner");
        assert.equal(dan, (await getListTop100())[0], "Dan not in fist place on listTop");
        assert.equal(carol, (await getListTop100())[1], "Carol not in second place on listTop");
        assert.equal(bob, (await getListTop100())[2], "Bob not in third place on listTop");
    });
});