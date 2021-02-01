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

  accounts = accounts.slice(0, 7);
  const [admin, bob, carol, dan, alice, karl, anna] = accounts;
  const userNames = {};
  userNames[admin] = "Admin";
  userNames[bob] = "Bob";
  userNames[carol] = "Carol";
  userNames[dan] = "Dan";
  userNames[alice] = "Alice";
  userNames[karl] = "Karl";
  userNames[anna] = "Anna"

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
      "0x00F96712cd4995bCd8647dd9Baa995286e4d5c99", //Fake
      99, //Fake
      86400,
      10
    );

    viewer = await web3tx(Viewer.new, "Deploy SuperAuctionViewer")();
  });

  afterEach(async function() {
    assert.ok(!(await sf.host.isAppJailed(app.address)), "App is Jailed");
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

  it("Case #1 - Bob joins new SuperAuction", async () => {
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

  it("Case #2 - Joining running SuperAuction (insert on top list)", async () => {
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
    const aliceFlowInfo = await joinAuction(alice, "5900000000");
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

  it("Case #3 - (Queue) Swap player SuperAuction (swap elements on list)", async () => {
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
    await timeTravelOnce(1800);
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
    aliceFlowInfo = await updateAuction(alice, "7850000000");
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
    carolFlowInfo = await updateAuction(carol, "18154200000");
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

  it("Case #4 - Players dropping auction", async () => {
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
    let aliceFlowInfo = await joinAuction(alice, "7100000000");
    await assertUserWinner(aliceFlowInfo);
    await assertTablePositions([alice, dan, carol]);
    await dropAuction(dan);
    await assertTablePositions([alice, carol]);
    await assertUserWinner(aliceFlowInfo);
    await dropAuction(alice);
    assert.equal(await app.winner(), carol, "Carol is not the winner");
  });

  //Check winner update self balance, check if winner stops being winner
  it("Case #5 - Players should maintain correct information", async () => {
    const bob1Flow = toBN(10000000);
    const bob2Flow = toBN(15000000);
    const bob3Flow = toBN(20000000);
    await joinAuction(bob, bob1Flow.toString());
    let bobQuery1 = await app.bidders(bob);

    assert.equal(bobQuery1.lastSettleAmount.toString(), "0", "Bob - Settle Amount should be zero");
    assert.equal(bobQuery1.cumulativeTimer.toString(), "0", "Bob - CumulativeTimer should be zero");
    assert.equal(bobQuery1.nextAccount.toString(), ZERO_ADDRESS, "Bob - next Account should be zero");

    await timeTravelOnce(100);
    let bobFlowInfo2 = await updateAuction(bob, bob2Flow);
    let bobQuery2 = await app.bidders(bob);

    console.log(bobQuery2.lastSettleAmount.toString());
    console.log(bobQuery2.cumulativeTimer.toString());


    await timeTravelOnce(100);
    let bobFlowInfo3 = await updateAuction(bob, bob3Flow);
    let bobQuery3 = await app.bidders(bob);

    console.log(bobQuery3.lastSettleAmount.toString());
    console.log(bobQuery3.cumulativeTimer.toString());


  });

  it("Case # - Winner ends the auction", async () => {
    await joinAuction(bob, "10000000");
    await joinAuction(carol, "1100000001");
    await joinAuction(dan, "5100000000");
    await joinAuction(alice, "15150000000");
    await timeTravelOnce(3600 * 25);
    await dropAuction(dan);
    assert.ok(
      await app.isFinish.call(),
      "Auction should finish after correct request"
    );
  });

  it("Case # - Should finish the auction explicity", async () => {
    await joinAuction(bob, "10000000");
    await joinAuction(carol, "1100000001");
    await joinAuction(dan, "5100000000");
    await joinAuction(alice, "15150000000");
    await timeTravelOnce(3600 * 25);
    await app.finishAuction();
    assert.ok(
      await app.isFinish.call(),
      "Auction should finish after correct request"
    );
  });

  it("Case # - Should finish the auction by update", async () => {
    await joinAuction(bob, "10000000");
    await joinAuction(carol, "1100000001");
    await joinAuction(dan, "5100000000");
    await timeTravelOnce(3600 * 25);
    await updateAuction(dan, "115150000000");
    assert.ok(
      await app.isFinish.call(),
      "Auction should finish after correct request"
    );
  });

  it("Case # - Winner pays winner bid", async () => {
    const initialAuctionBalance = await daix.balanceOf(app.address);
    const annaTokens1 = await daix.balanceOf(anna);
    await joinAuction(anna, toBN("100000"));
    await timeTravelOnce(3600 * 25);
    await dropAuction(anna);
    const annaTokens2 = await daix.balanceOf(anna);
    const howMuchAlicePay = annaTokens1.sub(annaTokens2);
    const auctionTokens = await daix.balanceOf(app.address);
    const howMuchAuctionGet = auctionTokens.sub(initialAuctionBalance);
    assert.equal(howMuchAlicePay.toString(), howMuchAuctionGet.toString(), "Auction is printing money");
    const adminTokens1 = await daix.balanceOf(admin);
    await web3tx(app.withdraw, `Admin getting auction tokens`)(
      { from: admin }
    );
    const adminTokens2 = await daix.balanceOf(admin);
    const howMuchOwnerReceives = adminTokens2.sub(adminTokens1);
    assert.equal(howMuchAlicePay.toString(),howMuchOwnerReceives.toString(), "Owner did get the full amount send by alice" );
    await web3tx(app.withdraw, `Admin getting auction tokens again`)(
      { from: admin }
    );
    const adminTokens3 = await daix.balanceOf(admin);
    assert.equal(adminTokens3.toString(), adminTokens1.add(howMuchOwnerReceives).toString(), "Admin is collecting more money after the withdraw");
  });
});
