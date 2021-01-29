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

    accounts = accounts.slice(0, 5);
    const [admin, bob, carol, dan, alice] = accounts;

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

    async function joinAuction(account, flowRate) {
        let obj = {};
        await sf.cfa.createFlow({
            superToken: daix.address,
            sender: account,
            receiver: app.address,
            flowRate: flowRate
        });

        return await sf.cfa.getFlow({
            superToken: daix.address,
            sender: account,
            receiver: app.address
        });
    }

    async function getFlowFromAuction(account) {
        return await sf.cfa.getFlow({
            superToken: daix.address,
            sender: app.address,
            receiver: account
        });
    }

    it("Case #1 - Bob joins new SuperAuction", async () => {
        const bobFlowInfo = await joinAuction(bob, "10000000");
        console.log(
            `Bob -> Auction flow : ${bobFlowInfo.flowRate.toString()}`
        );
        const auctionFlowInfo = await getFlowFromAuction(bob);

        const winner = await app.winner.call();
        const winnerFlowRate = await app.winnerFlowRate.call();
        assert.equal(winner, bob, "Bob should be the winner");
        assert.equal(winnerFlowRate.toString(), bobFlowInfo.flowRate.toString(), "Bob should have the correct flowRate as winner");
        assert.equal(0, auctionFlowInfo.flowRate, "Auction should not send stream to winner");
        assert.equal(bob, (await getListTop100())[0].account, "Bob not in fist place on listTop");
    });

    it("Case #2 - Joining running SuperAuction (insert on top list)", async () => {
        const bobFlowInfo = await joinAuction(bob, "10000000");
        const carolFlowInfo = await joinAuction(carol, "1100000001");
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
        assert.equal(carol, (await getListTop100())[0].account, "Carol not in fist place on listTop");
        assert.equal(bob, (await getListTop100())[1].account, "Bob not in second place on listTop");

        const danFlowInfo = await joinAuction(dan, "5100000000");
        console.log(
            `Dan -> Auction flow : ${danFlowInfo.flowRate.toString()}`
        );
        winner = await app.winner.call();
        winnerFlowRate = await app.winnerFlowRate.call();

        let auctionFlowInfoToBob = await getFlowFromAuction(bob);
        let auctionFlowInfoToCarol = await getFlowFromAuction(carol);
        let auctionFlowInfoToDan = await getFlowFromAuction(dan);

        assert.equal(winner, dan, "Dan should be the winner");
        assert.equal(winnerFlowRate.toString(), danFlowInfo.flowRate.toString(), "Dan should have the correct flowRate as winner");
        assert.equal(0, auctionFlowInfoToDan.flowRate, "Auction should not send stream to winner");
        assert.equal(bobFlowInfo.flowRate, auctionFlowInfoToBob.flowRate, "Bob should receive the same flow");
        assert.equal(carolFlowInfo.flowRate, auctionFlowInfoToCarol.flowRate, "Carol should receive the same flow");
        assert.equal(dan, (await getListTop100())[0].account, "Dan not in fist place on listTop");
        assert.equal(carol, (await getListTop100())[1].account, "Carol not in second place on listTop");
        assert.equal(bob, (await getListTop100())[2].account, "Bob not in third place on listTop");


        const aliceFlowInfo = await joinAuction(alice, "5150000000");
        console.log(
            `Alice -> Auction flow : ${bobFlowInfo.flowRate.toString()}`
        );

        winner = await app.winner.call();
        winnerFlowRate = await app.winnerFlowRate.call();

        auctionFlowInfoToBob = await getFlowFromAuction(bob);
        auctionFlowInfoToCarol = await getFlowFromAuction(carol);
        auctionFlowInfoToDan = await getFlowFromAuction(dan);
        let auctionFlowInfoToAlice = await getFlowFromAuction(alice);

        assert.equal(winner, alice, "Alice should be the winner");
        assert.equal(winnerFlowRate.toString(), aliceFlowInfo.flowRate.toString(), "Alice should have the correct flowRate as winner");
        assert.equal(0, auctionFlowInfoToAlice.flowRate, "Auction should not send stream to winner");
        assert.equal(bobFlowInfo.flowRate, auctionFlowInfoToBob.flowRate, "Bob should receive the same flow");
        assert.equal(carolFlowInfo.flowRate, auctionFlowInfoToCarol.flowRate, "Carol should receive the same flow");
        assert.equal(danFlowInfo.flowRate, auctionFlowInfoToDan.flowRate, "Dan should receive the same flow");
        assert.equal(alice, (await getListTop100())[0].account, "Alice not in fist place on listTop");
        assert.equal(dan, (await getListTop100())[1].account, "Dan not in fist place on listTop");
        assert.equal(carol, (await getListTop100())[2].account, "Carol not in second place on listTop");
        assert.equal(bob, (await getListTop100())[3].account, "Bob not in third place on listTop");
    });
});