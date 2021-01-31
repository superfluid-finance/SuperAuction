const { web3tx, toWad, toBN } = require("@decentral.ee/web3-helpers");
const { expectRevert } = require("@openzeppelin/test-helpers");
const deployFramework = require("@superfluid-finance/ethereum-contracts/scripts/deploy-framework");
const deployTestToken = require("@superfluid-finance/ethereum-contracts/scripts/deploy-test-token");
const deploySuperToken = require("@superfluid-finance/ethereum-contracts/scripts/deploy-super-token");
const SuperfluidSDK = require("@superfluid-finance/js-sdk");
const SuperAuction = artifacts.require("SuperAuction");
const Viewer = artifacts.require("SuperAuctionViewer");
const traveler = require("ganache-time-traveler");

const { ZERO_ADDRESS } = require("@openzeppelin/test-helpers").constants;
const TEST_TRAVEL_TIME = 3600 * 24; // 24 hours

contract("SuperAuction", accounts => {
  const errorHandler = err => {
    if (err) throw err;
  };

  accounts = accounts.slice(0, 6);
  const [admin, bob, carol, dan, alice, karl] = accounts;
  const userNames = {};
  userNames[admin] = "Admin";
  userNames[bob] = "Bob";
  userNames[carol] = "Carol";
  userNames[dan] = "Dan";
  userNames[alice] = "Alice";
  userNames[karl] = "Karl";

  let sf;
  let dai;
  let daix;
  let app;
  let viewer;

  async function timeTravelOnce(time) {
    const _time = time || TEST_TRAVEL_TIME;
    const block1 = await web3.eth.getBlock("latest");
    console.log("current block time", block1.timestamp);
    console.log(`time traveler going to the future +${_time}...`);
    await traveler.advanceTimeAndBlock(_time);
    const block2 = await web3.eth.getBlock("latest");
    console.log("new block time", block2.timestamp);
  }

  async function joinAuction(account, flowRate) {
    const data = await app.bidders(account);
    if (data.cumulativeTimer.toString() !== "0") {
      console.log(`${userNames[account]} is rejoining`);
    }

    const previousPlayerAddress = (await getPreviousPlayerUnfiltered(account))
      .account;
    let userData;
    if (previousPlayerAddress !== undefined) {
      console.log(previousPlayerAddress);
      userData = await web3.eth.abi.encodeParameters(
        ["address"],
        [previousPlayerAddress]
      );
    }
    await sf.cfa.createFlow({
      superToken: daix.address,
      sender: account,
      receiver: app.address,
      flowRate: flowRate,
      userData: userData
    });
    let obj = {};
    obj = await sf.cfa.getFlow({
      superToken: daix.address,
      sender: account,
      receiver: app.address
    });
    obj.account = account;
    return obj;
  }

  async function updateAuction(account, flowRate) {
    const previousPlayerAddress = (await getPreviousPlayer(account)).account;
    let userData;
    if (previousPlayerAddress !== undefined) {
      userData = await web3.eth.abi.encodeParameters(
        ["address"],
        [previousPlayerAddress]
      );
    }

    await sf.cfa.updateFlow({
      superToken: daix.address,
      sender: account,
      receiver: app.address,
      flowRate: flowRate,
      userData: userData
    });
    let obj = {};
    obj = await sf.cfa.getFlow({
      superToken: daix.address,
      sender: account,
      receiver: app.address
    });
    obj.account = account;
    return obj;
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
    return await viewer.getBiddersAddresses(app.address, 0, 100);
  }

  async function getPlayerPositionUnfiltered(account) {
    const scoreboard = await getListTop100();
    for (let i = 0; i < scoreboard.length; i++) {
      if (scoreboard[i].account == account) {
        return i;
      }
    }
    return 0;
  }

  async function getPreviousPlayerUnfiltered(account) {
    const pos = await getPlayerPositionUnfiltered(account);
    console.log("Unfilter positon:", pos);
    return pos == 0 ? ZERO_ADDRESS : (await getListTop100())[pos - 1];
  }

  async function getPlayerPosition(account) {
    const scoreboard = await getListTop100();

    const top = scoreboard.filter(item => item.flowRate > 0);

    for (let i = 0; i < top.length; i++) {
      if (top[i].account == account) {
        return i + 1;
      }
    }
    return 0;
  }

  async function checkPosition(account, scoreboardPosition) {
    return scoreboardPosition == 0
      ? false
      : (await getPlayerPosition(account)) == scoreboardPosition;
  }

  async function getPreviousPlayer(account) {
    const pos = await getPlayerPosition(account);
    return pos == 1 ? ZERO_ADDRESS : (await getListTop100())[pos - 2];
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
        await web3tx(dai.approve, `Account ${i} approves daix`)(
          daix.address,
          toWad(100),
          { from: accounts[i] }
        );

        await web3tx(daix.upgrade, `Account ${i} upgrades many DAIx`)(
          toWad(100),
          { from: accounts[i] }
        );
      }
    }
    app = await web3tx(SuperAuction.new, "Deploy SuperAuction")(
      sf.host.address,
      sf.agreements.cfa.address,
      daix.address,
      86400,
      10
    );

    viewer = await web3tx(Viewer.new, "Deploy SuperAuctionViewer")();
  });

  async function assertNoWinner() {
    const winner = await app.winner.call();
    const winnerFlowRate = await app.winnerFlowRate.call();
    assert.equal(winner, ZERO_ADDRESS, "no one should be the winner");
    assert.equal(
      winnerFlowRate.toString(),
      "0",
      "should not flowRate as winner"
    );
  }

  async function assertUserWinner(flowInfo) {
    const winner = await app.winner.call();
    const winnerFlowRate = await app.winnerFlowRate.call();
    assert.equal(
      winner,
      flowInfo.account,
      `${userNames[flowInfo.account]} should be the winner`
    );
    assert.equal(
      winnerFlowRate.toString(),
      flowInfo.flowRate.toString(),
      `${
        userNames[flowInfo.account]
      } should have the correct flowRate as winner`
    );
  }

  async function assertTablePositions(orderUsers) {
    for (let i = 0; i < orderUsers.length; i++) {
      assert.ok(
        await checkPosition(orderUsers[i], i + 1),
        `${userNames[orderUsers[i]]} not in right place listTop`
      );
    }
  }

  it.skip("Case #1 - Bob joins new SuperAuction", async () => {
    const bobFlowInfo = await joinAuction(bob, "10000000");
    console.log(`Bob -> Auction flow : ${bobFlowInfo.flowRate.toString()}`);
    const auctionFlowInfo = await getFlowFromAuction(bob);
    await assertUserWinner(bobFlowInfo);
    assert.equal(
      0,
      auctionFlowInfo.flowRate,
      "Auction should not send stream to winner"
    );
    await assertTablePositions([bob]);
    assert.equal(
      bob,
      (await getListTop100())[0].account,
      "Bob not in fist place on listTop"
    );
  });

  it.skip("Case #2 - Joining running SuperAuction (insert on top list)", async () => {
    const bobFlowInfo = await joinAuction(bob, "10000000");
    const carolFlowInfo = await joinAuction(carol, "1100000001");
    console.log(`Bob -> Auction flow : ${bobFlowInfo.flowRate.toString()}`);
    console.log(`Carol -> Auction flow : ${carolFlowInfo.flowRate.toString()}`);
    await assertUserWinner(carolFlowInfo, "carol");
    await assertTablePositions([carol, bob]);
    const danFlowInfo = await joinAuction(dan, "5100000000");
    console.log(`Dan -> Auction flow : ${danFlowInfo.flowRate.toString()}`);
    let auctionFlowInfoToBob = await getFlowFromAuction(bob);
    let auctionFlowInfoToCarol = await getFlowFromAuction(carol);
    let auctionFlowInfoToDan = await getFlowFromAuction(dan);
    await assertUserWinner(danFlowInfo);
    assert.equal(
      0,
      auctionFlowInfoToDan.flowRate,
      "Auction should not send stream to winner"
    );
    assert.equal(
      bobFlowInfo.flowRate,
      auctionFlowInfoToBob.flowRate,
      "Bob should receive the same flow"
    );
    assert.equal(
      carolFlowInfo.flowRate,
      auctionFlowInfoToCarol.flowRate,
      "Carol should receive the same flow"
    );
    await assertTablePositions([dan, carol, bob]);
    const aliceFlowInfo = await joinAuction(alice, "580000000");
    console.log(`Alice -> Auction flow : ${bobFlowInfo.flowRate.toString()}`);
    auctionFlowInfoToBob = await getFlowFromAuction(bob);
    auctionFlowInfoToCarol = await getFlowFromAuction(carol);
    auctionFlowInfoToDan = await getFlowFromAuction(dan);
    let auctionFlowInfoToAlice = await getFlowFromAuction(alice);
    await assertUserWinner(aliceFlowInfo);
    await assertTablePositions([alice, dan, carol, bob]);
    await expectRevert(
      joinAuction(karl, "5150000000"),
      "Auction: FlowRate is not enough"
    );
  });

  it.skip("Case #3 - (Queue) Swap player SuperAuction (swap elements on list)", async () => {
    let bobFlowInfo = await joinAuction(bob, "10000000");
    let carolFlowInfo = await joinAuction(carol, "1100000001");
    let danFlowInfo = await joinAuction(dan, "5100000000");
    let aliceFlowInfo = await joinAuction(alice, "5800000000");
    let auctionFlowInfoToBob = await getFlowFromAuction(bob);
    let auctionFlowInfoToCarol = await getFlowFromAuction(carol);
    let auctionFlowInfoToDan = await getFlowFromAuction(dan);
    let auctionFlowInfoToAlice = await getFlowFromAuction(alice);
    await assertTablePositions([alice, dan, carol, bob]);
    assert.equal(
      0,
      auctionFlowInfoToAlice.flowRate,
      "Auction should not send stream to winner"
    );
    assert.equal(
      carolFlowInfo.flowRate,
      auctionFlowInfoToCarol.flowRate,
      "Carol should receive the same flow"
    );
    assert.equal(
      danFlowInfo.flowRate,
      auctionFlowInfoToDan.flowRate,
      "Dan should receive the same flow"
    );
    assert.equal(
      bobFlowInfo.flowRate,
      auctionFlowInfoToBob.flowRate,
      "Bob should receive the same flow"
    );
    //Bob from last to top
    //await timeTravelOnce(3600 * 2);
    bobFlowInfo = await updateAuction(bob, "6850000000");
    auctionFlowInfoToBob = await getFlowFromAuction(bob);
    auctionFlowInfoToCarol = await getFlowFromAuction(carol);
    auctionFlowInfoToDan = await getFlowFromAuction(dan);
    auctionFlowInfoToAlice = await getFlowFromAuction(alice);
    await assertUserWinner(bobFlowInfo);
    await assertTablePositions([bob, alice, dan, carol]);
    assert.equal(
      0,
      auctionFlowInfoToBob.flowRate,
      "Auction should not send stream to winner"
    );
    assert.equal(
      carolFlowInfo.flowRate,
      auctionFlowInfoToCarol.flowRate,
      "Carol should receive the same flow"
    );
    assert.equal(
      aliceFlowInfo.flowRate,
      auctionFlowInfoToAlice.flowRate,
      "Alice should receive the same flow"
    );
    assert.equal(
      danFlowInfo.flowRate,
      auctionFlowInfoToDan.flowRate,
      "Dan should receive the same flow"
    );
    //Alice from second to top
    aliceFlowInfo = await updateAuction(alice, "7154000000");
    auctionFlowInfoToBob = await getFlowFromAuction(bob);
    auctionFlowInfoToCarol = await getFlowFromAuction(carol);
    auctionFlowInfoToDan = await getFlowFromAuction(dan);
    auctionFlowInfoToAlice = await getFlowFromAuction(alice);
    await assertUserWinner(aliceFlowInfo);
    await assertTablePositions([alice, bob, dan, carol]);
    assert.equal(
      0,
      auctionFlowInfoToAlice.flowRate,
      "Auction should not send stream to winner"
    );
    assert.equal(
      bobFlowInfo.flowRate,
      auctionFlowInfoToBob.flowRate,
      "Bob should receive the same flow"
    );
    assert.equal(
      carolFlowInfo.flowRate,
      auctionFlowInfoToCarol.flowRate,
      "Carol should receive the same flow"
    );
    assert.equal(
      danFlowInfo.flowRate,
      auctionFlowInfoToDan.flowRate,
      "Dan should receive the same flow"
    );
    //Carol third to top
    carolFlowInfo = await updateAuction(carol, "8154200000");
    auctionFlowInfoToBob = await getFlowFromAuction(bob);
    auctionFlowInfoToCarol = await getFlowFromAuction(carol);
    auctionFlowInfoToDan = await getFlowFromAuction(dan);
    auctionFlowInfoToAlice = await getFlowFromAuction(alice);
    await assertUserWinner(carolFlowInfo);
    await assertTablePositions([carol, alice, bob, dan]);
    assert.equal(
      0,
      auctionFlowInfoToCarol.flowRate,
      "Auction should not send stream to winner"
    );
    assert.equal(
      aliceFlowInfo.flowRate,
      auctionFlowInfoToAlice.flowRate,
      "Carol should receive the same flow"
    );
    assert.equal(
      bobFlowInfo.flowRate,
      auctionFlowInfoToBob.flowRate,
      "Bob should receive the same flow"
    );
    assert.equal(
      danFlowInfo.flowRate,
      auctionFlowInfoToDan.flowRate,
      "Dan should receive the same flow"
    );
  });

  it.skip("Case #4 - Players dropping auction", async () => {
    await joinAuction(bob, "10000000");
    let bobFlowInfo = await dropAuction(bob);
    await assertNoWinner();
    assert.equal(
      bobFlowInfo.flowRate,
      "0",
      "Bob should not be streaming to auction"
    );
    await assertUserWinner(await joinAuction(carol, "1100000001"));
    await assertUserWinner(await joinAuction(dan, "5100000000"));
    let aliceFlowInfo = await joinAuction(alice, "570000000");
    await assertUserWinner(aliceFlowInfo);
    await assertTablePositions([alice, dan, carol]);
    await dropAuction(dan);
    await assertTablePositions([alice, carol]);
    console.log(await getListTop100());
    await assertUserWinner(aliceFlowInfo);
    await dropAuction(alice);
    assert.equal(await app.winner(), carol, "Carol is not the winner");
  });

  //Check winner update self balance, check if winner stops being winner
  it.skip("Case #5 - Players should maintain correct information", async () => {
    const bob1Flow = toBN(10000000);
    const bob2Flow = toBN(6150000000);
    const bob3Flow = toBN(6150000001);

    let bobFlowInfo = await joinAuction(bob, bob1Flow);
    let bobMapInfo1 = await app.bidders(bob);
    let flowInfo = await getFlow(bob, app.address);

    assert.equal(
      bobMapInfo1.cumulativeTimer.toString(),
      "1",
      "Bob should not have cumulative time"
    );
    assert.equal(
      bobMapInfo1.lastSettleAmount.toString(),
      "0",
      "Bob should not have settle balance"
    );
    await timeTravelOnce(1800);

    bobMapInfo = await app.bidders(bob);
    assert.equal(
      bobMapInfo1.cumulativeTimer.toString(),
      "1",
      "Bob should not have cumulative time"
    );
    assert.equal(
      bobMapInfo1.lastSettleAmount.toString(),
      "0",
      "Bob should not have settle balance"
    );

    bobFlowInfo = await updateAuction(bob, bob2Flow);
    await timeTravelOnce(1800);

    bobMapInfo1 = await app.bidders(bob);
    assert.equal(
      bobMapInfo1.cumulativeTimer.mul(bob1Flow).toString(),
      bobMapInfo1.lastSettleAmount.add(bob1Flow).toString(),
      "Bob information is not consistent"
    );

    flowInfo = await getFlow(bob, app.address);
    bobFlowInfo = await updateAuction(bob, bob3Flow);
    let bobMapInfo2 = await app.bidders(bob);

    console.log(bobMapInfo2.cumulativeTimer.toString());
    console.log(bobMapInfo2.lastSettleAmount.toString());

    assert.equal(
      bobMapInfo2.cumulativeTimer.toString(),
      toBN(3601).toString(),
      "hdsjfhlaskdjfhasdkj"
    );

    assert.equal(
      bobMapInfo.cumulativeTimer.mul(bob2Flow).toString(),
      bobMapInfo.lastSettleAmount.add(bob2Flow).toString(),
      "Bob 2 information is not consistent"
    );
  });

  it.skip("Case # - Player should maintain information when rejoining", async () => {});

  it.skip("Case # - Winner ends the auction", async () => {
    await joinAuction(bob, "10000000");
    await joinAuction(carol, "1100000001");
    await joinAuction(dan, "5100000000");
    await joinAuction(alice, "5150000000");
    await timeTravelOnce(3600 * 25);
    await dropAuction(dan);
    assert.ok(
      await app.isFinish.call(),
      "Auction should finish after correct request"
    );
  });

  it.skip("Case # - Winner pays winner bid", async () => {});

  it.skip("Case # - Should finish the auction explicity", async () => {
    await joinAuction(bob, "10000000");
    await joinAuction(carol, "1100000001");
    await joinAuction(dan, "5100000000");
    await joinAuction(alice, "5150000000");
    await timeTravelOnce(3600 * 25);
    await app.finishAuction();
    assert.ok(
      await app.isFinish.call(),
      "Auction should finish after correct request"
    );
  });
});
