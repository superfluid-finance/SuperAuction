const { web3tx, toWad, toBN } = require("@decentral.ee/web3-helpers");
const { expectRevert, expectEvent } = require("@openzeppelin/test-helpers");
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

  accounts = accounts.slice(0,10);
  const [admin, bob, carol, dan, alice, karl, anna, ben, john, dude] = accounts;
  const userNames = {};
  userNames[admin] = "Admin";
  userNames[bob] = "Bob";
  userNames[carol] = "Carol";
  userNames[dan] = "Dan";
  userNames[alice] = "Alice";
  userNames[karl] = "Karl";
  userNames[anna] = "Anna";
  userNames[ben] = "Ben";
  userNames[john] = "John";
  userNames[dude] = "Dude";


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

  async function flowFromAuctionTo(account) {
    return await sf.cfa.getFlow({
      superToken: daix.address,
      sender: app.address,
      receiver: account
    });

  }

  async function getFlowFromAuction(account) {
    return await getFlow(app.address, account);
  }

  async function dropStream(sender, receiver, by) {
    await sf.cfa.deleteFlow({
      superToken: daix.address,
      sender: sender,
      receiver: receiver,
      by: by
    });

    return await sf.cfa.getFlow({
      superToken: daix.address,
      sender: sender,
      receiver: receiver
    });
  }

  async function startStream(sender, receiver, flowRate) {
    await sf.cfa.createFlow({
      superToken: daix.address,
      sender: sender,
      receiver: receiver,
      flowRate: flowRate
    });

    return await sf.cfa.getFlow({
      superToken: daix.address,
      sender: sender,
      receiver: receiver
    });
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
    const auctionFlow = await getFlowFromAuction(flowInfo.account);
    assert.equal(
      auctionFlow.flowRate,
      0,
      userNames[flowInfo.account] + " as winner, should not receive flow from auction"
    );
  }

  async function assertUserNonWinner(flowInfo) {
    const winner = await app.winner.call();
    const winnerFlowRate = await app.winnerFlowRate.call();
    assert.notEqual(
      winner,
      flowInfo.account,
      `${userNames[flowInfo.account]} should not be the winner`
    );
    assert.notEqual(
      winnerFlowRate.toString(),
      flowInfo.flowRate.toString(),
      `${
        userNames[flowInfo.account]
      } should not have the correct flowRate as winner`
    );
    const auctionFlow = await getFlowFromAuction(flowInfo.account);
    assert.equal(
      flowInfo.flowRate,
      auctionFlow.flowRate,
      userNames[flowInfo.account] + " as non winner should receive the same flow"
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


  beforeEach(async function() {

    await deployFramework(errorHandler, { web3: web3, from: admin });
    await deployTestToken(errorHandler, [":", "fDAI"], {
      web3: web3,
      from: admin
    });
    await deploySuperToken(errorHandler, [":", "fDAI"], {
      web3: web3,
      from: admin
    });

    sf = new SuperfluidSDK.Framework({
      web3: web3,
      tokens: ["fDAI"]
    });

    await sf.initialize();
    daix = sf.tokens.fDAIx;
    //if (!dai) {
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
    //}
    app = await web3tx(SuperAuction.new, "Deploy SuperAuction")(
      sf.host.address,
      sf.agreements.cfa.address,
      daix.address,
      "0x00F96712cd4995bCd8647dd9Baa995286e4d5c99", //Fake
      99, //Fake
      86400,
      10,
      ""
    );
    viewer = await web3tx(Viewer.new, "Deploy SuperAuctionViewer")();
  });

  afterEach(async function() {
    assert.ok(!(await sf.host.isAppJailed(app.address)), "App is Jailed");
  });


  it("Case #0 - Check deployment", async() => {

    await expectRevert(SuperAuction.new(
      ZERO_ADDRESS,
      //sf.host.address,
      sf.agreements.cfa.address,
      daix.address,
      "0x00F96712cd4995bCd8647dd9Baa995286e4d5c99", //Fake
      99, //Fake
      86400,
      10,
      ""
    ), "Auction: host is empty");

    await expectRevert(SuperAuction.new(
      sf.host.address,
      ZERO_ADDRESS,
      //sf.agreements.cfa.address,
      daix.address,
      "0x00F96712cd4995bCd8647dd9Baa995286e4d5c99", //Fake
      99, //Fake
      86400,
      10,
      ""
    ), "Auction: cfa is empty");

    await expectRevert(SuperAuction.new(
      sf.host.address,
      sf.agreements.cfa.address,
      ZERO_ADDRESS,
      //daix.address,
      "0x00F96712cd4995bCd8647dd9Baa995286e4d5c99", //Fake
      99, //Fake
      86400,
      10,
      ""
    ), "Auction: superToken is empty");

    await expectRevert(SuperAuction.new(
      sf.host.address,
      sf.agreements.cfa.address,
      daix.address,
      ZERO_ADDRESS,
      99, //Fake
      86400,
      10,
      ""
    ), "Auction: NFT contract is empty");

    await expectRevert(SuperAuction.new(
      sf.host.address,
      sf.agreements.cfa.address,
      daix.address,
      "0x00F96712cd4995bCd8647dd9Baa995286e4d5c99", //Fake
      99, //Fake
      0,
      10,
      ""
    ), "Auction: Provide a winner stream time");

    await expectRevert(SuperAuction.new(
      sf.host.address,
      sf.agreements.cfa.address,
      daix.address,
      "0x00F96712cd4995bCd8647dd9Baa995286e4d5c99", //Fake
      99, //Fake
      86400,
      101,
      ""
    ), "Auction: Step value wrong");

  });

  /*
    Auctions new players
  */

  it("Case #1 - Player joins a new auction - should be winner", async () => {
    const bobFlowInfo = await joinAuction(bob, "10000000");
    await assertUserWinner(bobFlowInfo);
    await assertTablePositions([bob]);
  });

  it("Case #2 - New player bid is higher than previous bid + step", async () => {
    const stepAmount = await app.step();
    await joinAuction(bob, "10000000");
    await joinAuction(alice, toBN(10000000).mul(stepAmount));
    await assertTablePositions([alice, bob]);
  });

  it("Case #3 - New player bid is revert if not higher than previous bid + step", async () => {
    await joinAuction(bob, "10000000");
    await expectRevert(joinAuction(alice, 999999), "Auction: FlowRate is not enough")
    await assertTablePositions([bob]);
  });

  it("Case #4 - After leaving player can't rejoin auction", async () => {
    await joinAuction(bob, "10000000");
    await timeTravelOnce(3600);
    await dropAuction(bob);
    await expectRevert(joinAuction(bob, "10000"), "Auction: sorry no rejoins");
  });

  it("Case #5 - New players entering running auction - last player should be new winner", async () => {
    const bobFlowInfo = await joinAuction(bob, "10000000");
    const carolFlowInfo = await joinAuction(carol, "1100000001");
    await assertUserWinner(carolFlowInfo);
    await assertUserNonWinner(bobFlowInfo)
    await assertTablePositions([carol, bob]);
    const danFlowInfo = await joinAuction(dan, "5100000000");
    await assertUserWinner(danFlowInfo);
    await assertUserNonWinner(carolFlowInfo);
    await assertUserNonWinner(bobFlowInfo);
    await assertTablePositions([dan, carol, bob]);
    const aliceFlowInfo = await joinAuction(alice, "5900000000");
    await assertUserNonWinner(danFlowInfo);
    await assertUserNonWinner(carolFlowInfo);
    await assertUserNonWinner(bobFlowInfo);
    await assertUserWinner(aliceFlowInfo);
    await assertTablePositions([alice, dan, carol, bob]);
  });

  it("Case #6 - Winner don't have stream from auction", async () => {
    const bobFlowInfo = await joinAuction(bob, "10000000");
    await assertUserWinner(bobFlowInfo);
    await assertTablePositions([bob]);
  });

  it("Case #7 - Non winner get stream from auction with the same flowRate as bid", async () => {
    const bobFlowInfo = await joinAuction(bob, "10000000");
    const carolFlowInfo = await joinAuction(carol, "1100000001");
    await assertUserWinner(carolFlowInfo, "carol");
    await assertTablePositions([carol, bob]);
    const danFlowInfo = await joinAuction(dan, "5100000000");
    await assertUserWinner(danFlowInfo);
    await assertUserNonWinner(carolFlowInfo);
    await assertUserNonWinner(bobFlowInfo);
    await assertTablePositions([dan, carol, bob]);
  });

  it("Case #8 - After auction is finished - no new players entering", async () => {
    await joinAuction(bob, "10000000");
    await joinAuction(carol, "1100000001");
    await joinAuction(dan, "5100000000");
    await joinAuction(alice, "15150000000");
    await timeTravelOnce(3600 * 25);
    await app.finishAuction();
    await expectRevert(joinAuction(karl, "995100000000"), "Auction: Not running");
  });

//Auction updates
  it("Case #9 - After auction finished no updates - should avoid late updates", async () => {
    await joinAuction(john, "10000000");
    await timeTravelOnce(3600 * 25);
    await app.finishAuction();
    await expectRevert(updateAuction(john, "51100000001"), "Auction: Not running")
  });

  it("Case #10 - Second player update to be winner", async () => {
    let bobFlowInfo = await joinAuction(bob, "10000000");
    let carolFlowInfo = await joinAuction(carol, "1100000001");
    await assertUserWinner(carolFlowInfo);
    await assertUserNonWinner(bobFlowInfo);
    bobFlowInfo = await updateAuction(bob, "51100000001")
    await assertUserWinner(bobFlowInfo);
    await assertTablePositions([bob, carol]);
  });

  it("Case #11 - Swap players in auction (swap elements on list) - should maintain correct list of player positions", async () => {
    let bobFlowInfo = await joinAuction(bob, "10000000");
    let carolFlowInfo = await joinAuction(carol, "1100000001");
    let danFlowInfo = await joinAuction(dan, "5100000000");
    let aliceFlowInfo = await joinAuction(alice, "5800000000");
    await assertUserNonWinner(bobFlowInfo);
    await assertUserNonWinner(carolFlowInfo);
    await assertUserNonWinner(danFlowInfo);
    await assertUserWinner(aliceFlowInfo);
    await assertTablePositions([alice, dan, carol, bob]);
    //Bob from last to top
    await timeTravelOnce(1800);
    bobFlowInfo = await updateAuction(bob, "6850000000");
    await assertUserWinner(bobFlowInfo);
    await assertUserNonWinner(carolFlowInfo);
    await assertUserNonWinner(danFlowInfo);
    await assertUserNonWinner(aliceFlowInfo);
    await assertTablePositions([bob, alice, dan, carol]);
    //Alice from second to top
    aliceFlowInfo = await updateAuction(alice, "7850000000");
    await assertUserNonWinner(bobFlowInfo);
    await assertUserNonWinner(carolFlowInfo);
    await assertUserNonWinner(danFlowInfo);
    await assertUserWinner(aliceFlowInfo);
    await assertTablePositions([alice, bob, dan, carol]);
    //Carol third to top
    carolFlowInfo = await updateAuction(carol, "18154200000");
    await assertUserNonWinner(bobFlowInfo);
    await assertUserWinner(carolFlowInfo);
    await assertUserNonWinner(danFlowInfo);
    await assertUserNonWinner(aliceFlowInfo);
    await assertTablePositions([carol, alice, bob, dan]);
  });

  it("Case #12 - Should revert when Previous account is wrong", async() => {
    const annaTokens1 = await daix.balanceOf(anna);
    const benTokens1 = await daix.balanceOf(ben);
    const johnTokens1 = await daix.balanceOf(john);
    await joinAuction(anna, "10000000");
    await joinAuction(ben, "1100000001");
    await joinAuction(john, "5100000000");
    await joinAuction(dude, "15100000000");
    await timeTravelOnce(3600);
    let userData = await web3.eth.abi.encodeParameters(["address"], [anna]);
    await expectRevert(sf.cfa.updateFlow({
      superToken: daix.address,
      sender: john,
      receiver: app.address,
      flowRate: "18100000000",
      userData: userData
    }), "Auction: Previous Bidder is wrong");
  });

  //Auction drops
  it("Case #13 - Winner dropping auction, no second player to select - should remove winner information", async () => {
    let bobFlowInfo = await joinAuction(bob, "10000000");
    await assertUserWinner(bobFlowInfo);
    await timeTravelOnce(1000);
    bobFlowInfo = await dropAuction(bob);
    await assertNoWinner();
    const auctionFlow = await getFlowFromAuction(bob);
    assert.ok(auctionFlow.flowRate == 0, "Auction is streaming to dropping winner");
  });

  it("Case #14 - Players dropping auction - should select second highest bid as new winner", async () => {
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
    await assertTablePositions([dan, carol]);
    let aliceFlowInfo = await joinAuction(alice, "7100000000");
    await assertUserWinner(aliceFlowInfo);
    await assertTablePositions([alice, dan, carol]);
    await dropAuction(dan);
    await assertTablePositions([alice, carol]);
    await assertUserWinner(aliceFlowInfo);
    await dropAuction(alice);
    assert.equal(await app.winner(), carol, "Carol is not the winner");
  });

  it("Case #15 - Player non winner dropping auction", async () => {
    await joinAuction(bob, "10000000");
    let aliceFlowInfo = await joinAuction(alice, "7100000000");
    await joinAuction(dan, "15100000000");
    aliceFlowInfo = await dropAuction(alice);
    let auctionFlow = await getFlowFromAuction(alice);
    assert.equal(aliceFlowInfo.flowRate.toString(), "0", "Alice - Is still receiving auction stream");
    assert.equal(auctionFlow.flowRate.toString(), "0", "Alice - Is still receiving auction stream");
  });

  it("Case #16 - Player non winner dropping auction (remove both streams)", async () => {
    await joinAuction(bob, "10000000");
    await joinAuction(alice, "7100000000");
    const auctionToBobFLow = await dropStream(app.address, bob, bob);
    const bobToAuction = await getFlow(bob, app.address);
    assert.equal(auctionToBobFLow.flowRate.toString(), "0", "Bob - Is receiving auction stream");
    console.log(bobToAuction);
    assert.equal(bobToAuction.flowRate.toString(), "0", "Bob - Is sending to auction");
  });

  it("Case #17 - Dropping players don't send or receive stream from auction", async () => {
    await joinAuction(bob, "10000000");
    await joinAuction(alice, "15000000");
    await joinAuction(carol, "1100000001");
    await joinAuction(dan, "5100000000");
    await dropAuction(bob);
    await dropAuction(alice);
    await dropAuction(carol);
    await dropAuction(dan);
    await assertNoWinner();
  });
  //Auction closed
  it("Case #18 - winner ends the auction by leaving - should finish the auction", async () => {
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

  it("Case #19 - admin can finish auction if there is no winner - should finish the auction", async () => {
    assert.isFalse(await app.isFinish.call());
    await app.stopAuction();
    assert.isTrue(await app.isFinish.call())
  });

  it("Case #20 - admin try to finish a auction with winner", async () => {
    await joinAuction(bob, "10000");
    assert.isFalse(await app.isFinish.call());
    await app.stopAuction();
    assert.isFalse(await app.isFinish.call())
  });

  it("Case #21 - admin try to finish a auction without winner (finishAuction)", async () => {
    assert.isFalse(await app.isFinish.call());
    await app.finishAuction();
    assert.isFalse(await app.isFinish.call())
  });

  it("Case #22 - Should finish the auction explicity", async () => {
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

  it("Case #23 - Should finish the auction by update", async () => {
    await joinAuction(bob, "10000000");
    await joinAuction(carol, "1100000001");
    await joinAuction(dan, "5100000000");
    await timeTravelOnce(3600 * 25);
    await dropAuction(bob, "10000000");
    assert.ok(
      await app.isFinish.call(),
      "Auction should finish after correct request"
    );
  });

  it("Case #24 - Should finish the auction by admin call", async () => {
    await joinAuction(bob, "10000000");
    await joinAuction(carol, "1100000001");
    await joinAuction(dan, "5100000000");
    await timeTravelOnce(3600 * 25);
    await app.finishAuction();
    assert.isTrue(await app.isFinish(), "Auction should be stopped");
  });

  it("Case #25 - Player tries to enter after finished auction", async () => {
    await joinAuction(bob, "10000000");
    await joinAuction(carol, "1100000001");
    await joinAuction(dan, "5100000000");
    await joinAuction(alice, "15150000000");
    await timeTravelOnce(3600 * 25);
    await app.finishAuction();
    expectRevert(joinAuction(karl, "995100000000"), "Auction: Not running");
  });

  //After auction finished
  it("Case #26 - Winner pays winner bid", async () => {
    const initialAuctionBalance = await daix.balanceOf(app.address);
    const annaTokens1 = await daix.balanceOf(anna);
    await joinAuction(anna, toBN("100000"));
    await timeTravelOnce(3600 * 30);
    await dropAuction(anna);
    assert.isTrue(await app.isFinish(), "Auction should be closed");
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
    assert.equal(howMuchAlicePay.toString(),howMuchOwnerReceives.toString(), "Owner didnt get the full amount send by alice" );
    const adminTokens3 = await daix.balanceOf(admin);
    assert.equal(adminTokens3.toString(), adminTokens1.add(howMuchOwnerReceives).toString(), "Admin is collecting more money after the withdraw");
  });

  it("Case #27 - Non Winner can withdraw the correct token amount after auction finished", async () => {
    const annaTokens1 = await daix.balanceOf(anna);
    const benTokens1 = await daix.balanceOf(ben);
    await joinAuction(anna, "10000000");
    await joinAuction(ben, "1100000001");
    await joinAuction(dude, "15100000000");
    await timeTravelOnce(3600 * 25);
    await app.finishAuction();
    await dropAuction(anna);
    await dropAuction(ben);
    const annaTokens2 = await daix.balanceOf(anna);
    const benTokens2 = await daix.balanceOf(ben);
    assert.equal(annaTokens1.toString(), annaTokens2.toString(), "Anna should have the same tokens");
    assert.equal(benTokens1.toString(), benTokens2.toString(), "Ben should have the same tokens");
  });

  it("Case #28 - Non winner don't get token amount before auction ending - Auction still running", async () => {
    await joinAuction(anna, "10000000");
    await joinAuction(ben, "1100000001");
    await joinAuction(dude, "15100000000");
    await timeTravelOnce(3600);
    assert.isFalse(await app.isFinish.call());
    await dropAuction(anna);
    await dropAuction(ben);
    await dropAuction(dude);
    await expectRevert(app.withdrawNonWinner({from: alice}), "Auction: Still running");
    await expectRevert(app.withdrawNonWinner({from: ben}), "Auction: Still running");
    await expectRevert(app.withdrawNonWinner({from: dude}), "Auction: Still running");
  });

  it("Case #29 - Winner can't use withdrawNonWinner - Auction still running", async () => {
    await joinAuction(anna, "10000000");
    await joinAuction(ben, "1100000001");
    await joinAuction(dude, "15100000000");
    await timeTravelOnce(3600);
    assert.isFalse(await app.isFinish.call());
    await expectRevert(app.withdrawNonWinner({from: dude}), "Auction: Caller is the winner");
  });

  //Auction liquidations
  it("Case #30 - Only player gets liquidated by external account", async () => {
    const benFlowInfo = await joinAuction(ben, "151000000000000");
    await timeTravelOnce(3600);
    await daix.transferAll(admin, {from: ben});
    await timeTravelOnce(3600);
    assert.isFalse(await app.isFinish(), "Auction should be open");
    await dropStream(ben, app.address, admin);
    assert.isFalse(await app.isFinish(), "Auction should be open after drop");
    await assertNoWinner();
  });

  it("Case #31 - Non Winner gets liquidated by external account", async () => {
    const bobFlowInfo = await joinAuction(bob, "151000000000000");
    await startStream(bob, admin, "100000000000");
    const carolFlowInfo = await joinAuction(carol, "251000000000000");
    await timeTravelOnce(3600);
    await assertUserWinner(carolFlowInfo);
    await assertUserNonWinner(bobFlowInfo)
    await assertTablePositions([carol, bob]);
    await daix.transferAll(admin, {from: bob});
    await timeTravelOnce(3600 * 2);
    assert.isFalse(await app.isFinish(), "Auction should be open");
    await dropStream(bob, app.address, admin);
    assert.isFalse(await app.isFinish(), "Auction should be open after drop");
    await assertUserWinner(carolFlowInfo);
  });

  it("Case #32 - Winner gets liquidated by external account - should set next player as winner", async () => {
    const benFlowInfo = await joinAuction(ben, "151000");
    const johnFlowInfo = await joinAuction(john, "251000");
    const dudeFlowInfo = await joinAuction(dude, "501000");
    await timeTravelOnce(3600);
    await assertUserWinner(dudeFlowInfo);
    await assertUserNonWinner(johnFlowInfo)
    await assertUserNonWinner(benFlowInfo)
    await assertTablePositions([dude, john, ben]);
    await daix.transferAll(admin, {from: dude});
    await timeTravelOnce(3600 * 2);
    assert.isFalse(await app.isFinish(), "Auction should be open");
    await dropStream(dude, app.address, admin);
    assert.isFalse(await app.isFinish(), "Auction should be open after drop");
    await assertUserWinner(johnFlowInfo);
    await assertTablePositions([john, ben]);
  });

  it("Case #33 - Winner gets liquidated after auction ending date", async () => {
    const aliceFlowInfo = await joinAuction(alice, "2000000");
    await timeTravelOnce(3600 * 10);
    const carolFlowInfo = await joinAuction(carol, "3151000");
    await assertUserWinner(carolFlowInfo);
    await assertTablePositions([carol, alice]);
    await timeTravelOnce(3600 * 25);
    await daix.transferAll(admin, {from: carol});
    await timeTravelOnce(3600);
    await assertUserWinner(carolFlowInfo);
    await assertUserNonWinner(aliceFlowInfo);
    assert.isFalse(await app.isFinish(), "Auction should be open");
    await dropStream(carol, app.address, admin);
    await dropAuction(alice);
    await app.withdrawNonWinner({from: alice});
    assert.isTrue(await app.isFinish(), "Auction should be open after drop");
    await timeTravelOnce(3600 * 25);
    assert.equal((await app.winner()), carol, "Auction: Carol should be winner after liquidation");
    await web3tx(app.withdraw, `Admin getting auction tokens`)(
      { from: admin }
    );
  });

});
