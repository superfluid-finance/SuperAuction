const { web3tx, toWad, toBN } = require("@decentral.ee/web3-helpers");
const { expectRevert } = require("@openzeppelin/test-helpers");
const deployFramework = require("@superfluid-finance/ethereum-contracts/scripts/deploy-framework");
const deployTestToken = require("@superfluid-finance/ethereum-contracts/scripts/deploy-test-token");
const deploySuperToken = require("@superfluid-finance/ethereum-contracts/scripts/deploy-super-token");
const SuperfluidSDK = require("@superfluid-finance/js-sdk");
const SuperAuction = artifacts.require("SuperAuction");


const { ZERO_ADDRESS } = require("@openzeppelin/test-helpers").constants;

contract("SuperAuction", accounts => {
    const errorHandler = err => {
        if (err) throw err;
    };

    accounts = accounts.slice(0, 6);
    const [admin, bob, carol, dan, alice, karl] = accounts;

    let sf;
    let dai;
    let daix;
    let app;


    async function joinAuction(account, flowRate) {
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

    async function updateAuction(account, flowRate) {
        const previousPlayerAddress = (await getPreviousPlayer(account)).account;
        await sf.cfa.updateFlow({
            superToken: daix.address,
            sender: account,
            receiver: app.address,
            flowRate: flowRate,
            userData: await web3.eth.abi.encodeParameters(
                ["address"],
                [
                    previousPlayerAddress
                ]
            )
        });

        return await sf.cfa.getFlow({
            superToken: daix.address,
            sender: account,
            receiver: app.address
        });
    }

    async function dropAuction(account) {
        await sf.cfa.deleteFlow({
            superToken: daix.address,
            sender: account,
            receiver: app.address
        });

        return await sf.cfa.getFlow({
            superToken: daix.address,
            sender: account,
            receiver: app.address
        });

    }

    async function getFlowFromAuction(account) {
        return await getFlow(app.address, account);
    }

    async function getFlowFromUser(account) {
        return await getFlow(account, app.address);
    }


    async function getFlow(sender, receiver) {
        return await sf.cfa.getFlow({
            superToken: daix.address,
            sender: sender,
            receiver: receiver
        });
    }

    async function getListTop100() {
        return await app.getBiddersAddresses(0, 100);
    }

    async function getPlayerPosition(account) {
        const scoreboard = await getListTop100();
        for(let i = 0; i < 100; i++) {
            if(scoreboard[i].account == account) {
                return (i+1);
            }
        }
        return 0;
    }

    async function checkPosition(account, scoreboardPosition) {
        if(scoreboardPosition == 0) {
            return false;
        }

        return await getPlayerPosition(account) == scoreboardPosition;
    }

    async function getPreviousPlayer(account) {
        const pos = await getPlayerPosition(account);
        if(pos == 1) {
            return ZERO_ADDRESS;
        }

        return (await getListTop100())[pos - 2];
    }


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
        assert.ok((await checkPosition(dan, 1)), "Dan not in fist place on listTop");
        assert.ok((await checkPosition(carol, 2)), "Carol not in second place on listTop");
        assert.ok((await checkPosition(bob, 3)), "Bob not in third place on listTop");


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
        assert.ok((await checkPosition(alice, 1)), "Alice not in fist place on listTop");
        assert.ok((await checkPosition(dan, 2)), "Dan not in fist place on listTop");
        assert.ok((await checkPosition(carol, 3)), "Carol not in second place on listTop");
        assert.ok((await checkPosition(bob, 4)), "Bob not in third place on listTop");

        await expectRevert(
            joinAuction(karl, "5150000000"),
            "Auction: FlowRate is not enough"
        );
    });

    it("Case #3 - Swap player SuperAuction (swap elements on list)", async () => {

        let bobFlowInfo = await joinAuction(bob, "10000000");
        let carolFlowInfo = await joinAuction(carol, "1100000001");
        let danFlowInfo = await joinAuction(dan, "5100000000");
        let aliceFlowInfo = await joinAuction(alice, "5150000000");

        let auctionFlowInfoToBob = await getFlowFromAuction(bob);
        let auctionFlowInfoToCarol = await getFlowFromAuction(carol);
        let auctionFlowInfoToDan = await getFlowFromAuction(dan);
        let auctionFlowInfoToAlice = await getFlowFromAuction(alice);

        assert.ok((await checkPosition(alice, 1)), "Alice not in fist place on listTop");
        assert.ok((await checkPosition(dan, 2)), "Dan not in fist place on listTop");
        assert.ok((await checkPosition(carol, 3)), "Carol not in second place on listTop");
        assert.ok((await checkPosition(bob, 4)), "Bob not in third place on listTop");
        assert.equal(0, auctionFlowInfoToAlice.flowRate, "Auction should not send stream to winner");
        assert.equal(carolFlowInfo.flowRate, auctionFlowInfoToCarol.flowRate, "Carol should receive the same flow");
        assert.equal(danFlowInfo.flowRate, auctionFlowInfoToDan.flowRate, "Dan should receive the same flow");
        assert.equal(bobFlowInfo.flowRate, auctionFlowInfoToBob.flowRate, "Bob should receive the same flow");

        //Bob from last to top
        bobFlowInfo = await updateAuction(bob, "6150000000");

        auctionFlowInfoToBob = await getFlowFromAuction(bob);
        auctionFlowInfoToCarol = await getFlowFromAuction(carol);
        auctionFlowInfoToDan = await getFlowFromAuction(dan);
        auctionFlowInfoToAlice = await getFlowFromAuction(alice);

        let winner = await app.winner.call();
        let winnerFlowRate = await app.winnerFlowRate.call();
        assert.equal(winner, bob, "Bob should be the winner");
        assert.equal(winnerFlowRate.toString(), bobFlowInfo.flowRate.toString(), "Bob should have the correct flowRate as winner");
        assert.ok((await checkPosition(bob, 1)), "Bob not in fist place on listTop");
        assert.ok((await checkPosition(alice, 2)), "Alice not in second place on listTop");
        assert.ok((await checkPosition(dan, 3)), "Dan not in third place on listTop");
        assert.ok((await checkPosition(carol, 4)), "Carol not in forth place on listTop");
        assert.equal(0, auctionFlowInfoToBob.flowRate, "Auction should not send stream to winner");
        assert.equal(aliceFlowInfo.flowRate, auctionFlowInfoToAlice.flowRate, "Alice should receive the same flow");
        assert.equal(carolFlowInfo.flowRate, auctionFlowInfoToCarol.flowRate, "Carol should receive the same flow");
        assert.equal(danFlowInfo.flowRate, auctionFlowInfoToDan.flowRate, "Dan should receive the same flow");

        //Alice from second to top

        aliceFlowInfo = await updateAuction(alice, "6154000000");

        auctionFlowInfoToBob = await getFlowFromAuction(bob);
        auctionFlowInfoToCarol = await getFlowFromAuction(carol);
        auctionFlowInfoToDan = await getFlowFromAuction(dan);
        auctionFlowInfoToAlice = await getFlowFromAuction(alice);

        winner = await app.winner.call();
        winnerFlowRate = await app.winnerFlowRate.call();
        assert.equal(winner, alice, "Alice should be the winner");
        assert.equal(winnerFlowRate.toString(), aliceFlowInfo.flowRate.toString(), "Alice should have the correct flowRate as winner");
        assert.ok((await checkPosition(alice, 1)), "Alice not in second place on listTop");
        assert.ok((await checkPosition(bob, 2)), "Bob not in second place on listTop");
        assert.ok((await checkPosition(dan, 3)), "Dan not in third place on listTop");
        assert.ok((await checkPosition(carol, 4)), "Carol not in forth place on listTop");
        assert.equal(0, auctionFlowInfoToAlice.flowRate, "Auction should not send stream to winner");
        assert.equal(bobFlowInfo.flowRate, auctionFlowInfoToBob.flowRate, "Bob should receive the same flow");
        assert.equal(carolFlowInfo.flowRate, auctionFlowInfoToCarol.flowRate, "Carol should receive the same flow");
        assert.equal(danFlowInfo.flowRate, auctionFlowInfoToDan.flowRate, "Dan should receive the same flow");

        //Carol third to top
        carolFlowInfo = await updateAuction(carol, "6154200000");
        auctionFlowInfoToBob = await getFlowFromAuction(bob);
        auctionFlowInfoToCarol = await getFlowFromAuction(carol);
        auctionFlowInfoToDan = await getFlowFromAuction(dan);
        auctionFlowInfoToAlice = await getFlowFromAuction(alice);

        winner = await app.winner.call();
        winnerFlowRate = await app.winnerFlowRate.call();
        assert.equal(winner, carol, "Carol should be the winner");
        assert.equal(winnerFlowRate.toString(), carolFlowInfo.flowRate.toString(), "Carol should have the correct flowRate as winner");
        assert.ok((await checkPosition(carol, 1)), "Carol not in first place on listTop");
        assert.ok((await checkPosition(alice, 2)), "Alice not in second place on listTop");
        assert.ok((await checkPosition(bob, 3)), "Bob not in third place on listTop");
        assert.ok((await checkPosition(dan, 4)), "Dan not in forth place on listTop");
        assert.equal(0, auctionFlowInfoToCarol.flowRate, "Auction should not send stream to winner");
        assert.equal(aliceFlowInfo.flowRate, auctionFlowInfoToAlice.flowRate, "Carol should receive the same flow");
        assert.equal(bobFlowInfo.flowRate, auctionFlowInfoToBob.flowRate, "Bob should receive the same flow");
        assert.equal(danFlowInfo.flowRate, auctionFlowInfoToDan.flowRate, "Dan should receive the same flow");
    });


    it.only("Case #4 - Players dropping auction", async () => {

        await joinAuction(bob, "10000000");
        let bobFlowInfo = await dropAuction(bob);

        let winner = await app.winner.call();
        let winnerFlowRate = await app.winnerFlowRate.call();

        assert.equal(winner, ZERO_ADDRESS, "no one should be the winner");
        assert.equal(winnerFlowRate.toString(), "0", "should not flowRate as winner");
        assert.equal(bobFlowInfo.flowRate, "0", "Bob should not be streaming to auction");

        await joinAuction(bob, "10000000");
        let carolFlowInfo = await joinAuction(carol, "1100000001");

        let auctionFlowInfoToCarol = await getFlowFromAuction(carol);
        bobFlowInfo = await dropAuction(bob);
        winner = await app.winner.call();
        winnerFlowRate = await app.winnerFlowRate.call();

        assert.equal(winner, carol, "Carol should be the winner");
        assert.equal(winnerFlowRate.toString(), carolFlowInfo.flowRate.toString(), "Carol should have the correct flowRate as winner");
        assert.equal(bobFlowInfo.flowRate, "0", "Bob should not be streaming to auction");

        await joinAuction(dan, "5100000000");
        let aliceFlowInfo = await joinAuction(alice, "5150000000");
        await joinAuction(bob, "15150000000");

        await dropAuction(dan);
        await dropAuction(bob);

        winner = await app.winner.call();
        winnerFlowRate = await app.winnerFlowRate.call();
        assert.equal(winner, alice, "Carol should be the winner");
        assert.equal(winnerFlowRate.toString(), aliceFlowInfo.flowRate.toString(), "Alice should have the correct flowRate as winner");

    });

});