const {toBN} = require("web3-utils");
const GROToken = artifacts.require("GROToken");
const GRODistributer = artifacts.require("GRODistributer");
const GROVesting = artifacts.require("GROVesting");
const LPTokenStaker = artifacts.require("LPTokenStaker");
const LPTokenStakerV1 = artifacts.require("LPTokenStakerV1");
const MockToken = artifacts.require("MockTokenWithOwner");
const MockMigrator = artifacts.require("MockMigrator");
const {constants} = require("../utils/constants");
const {expect} = require("../utils/common-utils");
const {isBytes} = require("@ethersproject/bytes");

contract("LPTokenStaker", function (accounts) {
    const INIT_MAX_TOTAL_SUPPLY = toBN(10_000_000).mul(constants.DEFAULT_FACTOR);
    const NON_INFLATION_PERIOD = toBN(3).mul(constants.ONE_YEAR_SECONDS);
    const INIT_UNLOCKED_PERCENT = toBN(1000);
    const INSTANT_EXIT_PERCENT = toBN(3000);
    const ACC_GRO_PRECISION = toBN(1e12);

    const [deployer, groDeployer, dao, burner, timeLock] = accounts;
    let gro, groDist, groVest, staker, lpt1, lpt2;

    describe("features", function () {
        beforeEach(async function () {
            gro = await GROToken.new("GRO", "GRO", INIT_MAX_TOTAL_SUPPLY, NON_INFLATION_PERIOD, {from: groDeployer});
            groVest = await GROVesting.new(constants.ZERO_ADDRESS, timeLock);
            vesters = [dao, deployer, groDeployer, groVest.address];
            groDist = await GRODistributer.new(gro.address, vesters, burner);
            await gro.setDistributer(groDist.address, {from: groDeployer});
            await groVest.setDistributer(groDist.address);
            await gro.setDistributer(groDist.address, {from: groDeployer});

            await groVest.setVester(deployer, true);
            staker = await LPTokenStaker.new(timeLock);
            await staker.setVesting(groVest.address);
            await groVest.setVester(staker.address, true);

            await staker.setMaxGroPerBlock(toBN(10000).mul(constants.DEFAULT_FACTOR));

            lpt1 = await MockToken.new("LPT1", "LPT1");
            lpt2 = await MockToken.new("LPT2", "LPT2");

            await lpt1.mint(deployer, toBN(1_000_000).mul(constants.DEFAULT_FACTOR));
            await lpt2.mint(deployer, toBN(1_000_000).mul(constants.DEFAULT_FACTOR));
            await lpt1.approve(staker.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR));
            await lpt2.approve(staker.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR));

            await lpt1.mint(dao, toBN(1_000_000).mul(constants.DEFAULT_FACTOR));
            await lpt2.mint(dao, toBN(1_000_000).mul(constants.DEFAULT_FACTOR));
            await lpt1.approve(staker.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR), {from: dao});
            await lpt2.approve(staker.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR), {from: dao});

            await groVest.setStatus(false, {from: timeLock});
            await staker.setStatus(false, {from: timeLock});
        });

        describe("Ownership", function () {
            it("setManager revert !Ownership", async () => {
                return expect(staker.setManager(constants.ZERO_ADDRESS, {from: dao})).to.eventually.be.rejectedWith(
                    "caller is not the owner"
                );
            });

            it("setMaxGroPerBlock revert !Ownership", async () => {
                return expect(staker.setMaxGroPerBlock(1, {from: dao})).to.eventually.be.rejectedWith(
                    "caller is not the owner"
                );
            });

            it("setNewStaker revert !Ownership", async () => {
                return expect(staker.setNewStaker(constants.ZERO_ADDRESS, {from: dao})).to.eventually.be.rejectedWith(
                    "caller is not the owner"
                );
            });

            it("setOldStaker revert !Ownership", async () => {
                return expect(staker.setOldStaker(constants.ZERO_ADDRESS, {from: dao})).to.eventually.be.rejectedWith(
                    "caller is not the owner"
                );
            });

            it("setStatus revert !timeLock", async () => {
                return expect(staker.setStatus(false)).to.eventually.be.rejectedWith("msg.sender != timelock");
            });
        });

        describe("setGroPerBlock", function () {
            it("revert !manager", async () => {
                return expect(staker.setGroPerBlock(1)).to.eventually.be.rejectedWith("setGroPerBlock: !manager");
            });

            it("revert > maxGroPerBlock", async () => {
                await staker.setManager(deployer);

                return expect(
                    staker.setGroPerBlock(toBN(20000).mul(constants.DEFAULT_FACTOR))
                ).to.eventually.be.rejectedWith("setGroPerBlock: > maxGroPerBlock");
            });
        });

        describe("add", function () {
            it("revert !manager", async () => {
                return expect(staker.add(1, dao, {from: dao})).to.eventually.be.rejectedWith("!manager");
            });

            it("Should not be possible for owner to add new pools", async () => {
                await expect(staker.owner()).to.eventually.be.equal(deployer);
                return expect(staker.add(1, dao, {from: deployer})).to.eventually.be.rejectedWith("!manager");
            });

            it("ok", async () => {
                await staker.setManager(deployer);
                const ap = toBN(1);
                await staker.add(ap, dao);
                const pi = await staker.poolInfo(0);
                expect(pi.allocPoint).be.a.bignumber.equal(ap);
                expect(pi.lpToken).equal(dao);
                await expect(staker.poolLength()).to.eventually.be.a.bignumber.equal(toBN(1));
                return expect(staker.totalAllocPoint()).to.eventually.be.a.bignumber.equal(ap);
            });

            it("Should not be possible to add the same LP token twice", async () => {
                await staker.setManager(deployer);
                const ap = toBN(1);
                await expect(staker.add(ap, dao)).to.eventually.be.fulfilled;
                const pi = await staker.poolInfo(0);
                expect(pi.allocPoint).be.a.bignumber.equal(ap);
                expect(pi.lpToken).equal(dao);
                return expect(staker.add(ap, dao)).to.eventually.be.rejected;
            });
        });

        describe("set", function () {
            it("revert !manager", async () => {
                return expect(staker.set(1, 1)).to.eventually.be.rejectedWith("set: !manager");
            });

            it("Should not be possible for owner to set pool info", async () => {
                await expect(staker.owner()).to.eventually.be.equal(deployer);
                return expect(staker.set(1, 1, {from: deployer})).to.eventually.be.rejectedWith("!manager");
            });

            it("ok", async () => {
                await staker.setManager(dao);

                const ap = toBN(1);
                const nap = toBN(10);
                await staker.add(ap, dao, {from: dao});
                await staker.set(0, nap, {from: dao});
                const pi = await staker.poolInfo(0);
                expect(pi.allocPoint).be.a.bignumber.equal(nap);
                return expect(staker.totalAllocPoint()).to.eventually.be.a.bignumber.equal(nap);
            });
        });

        describe("updatePool", function () {
            it("no change", async () => {
                await staker.setManager(dao);

                const ap = toBN(1);
                await staker.add(ap, dao, {from: dao});
                const pi = await staker.updatePool.call(0);
                expect(pi.allocPoint).be.a.bignumber.equal(ap);

                return;
            });

            it("Should not be possible to update pools when the totalAllocPoints == 0", async () => {
                await staker.setManager(dao);

                const ap = toBN(0);
                await staker.add(ap, dao, {from: dao});
                await expect(staker.claimable(0, dao)).to.eventually.be.a.bignumber.equal(toBN(0));
                return expect(staker.updatePool(0)).to.eventually.be.rejected;
            });

            it("ok", async () => {
                await staker.setManager(deployer);

                const ap1 = toBN(1);
                await staker.add(ap1, lpt1.address);
                const ap2 = toBN(2);
                await staker.add(ap2, lpt2.address);

                const amount = toBN(10000).mul(constants.DEFAULT_FACTOR);
                await staker.deposit(0, amount);
                const b1 = await web3.eth.getBlockNumber();

                const gpb = toBN(3).mul(constants.DEFAULT_FACTOR);
                await staker.setGroPerBlock(gpb);

                await staker.updatePool(0);
                const b2 = await web3.eth.getBlockNumber();

                let pi = await staker.poolInfo(0);
                const gpb1 = gpb.mul(ap1).div(ap1.add(ap2));
                expect(pi.accGroPerShare).be.a.bignumber.equal(
                    toBN(b2).sub(toBN(b1)).mul(ACC_GRO_PRECISION).mul(gpb1).div(amount)
                );
                expect(pi.lastRewardBlock).be.a.bignumber.equal(toBN(b2));

                await staker.updatePool(1);
                const b3 = await web3.eth.getBlockNumber();
                pi = await staker.poolInfo(1);
                expect(pi.accGroPerShare).be.a.bignumber.equal(toBN(0));
                expect(pi.lastRewardBlock).be.a.bignumber.equal(toBN(b3));

                return;
            });

            it("massUpdatePools", async () => {
                await staker.setManager(deployer);

                const ap1 = toBN(1);
                await staker.add(ap1, lpt1.address);
                const ap2 = toBN(2);
                await staker.add(ap2, lpt2.address);

                const amount = toBN(10000).mul(constants.DEFAULT_FACTOR);
                await staker.deposit(0, amount);
                const b1 = await web3.eth.getBlockNumber();

                const gpb = toBN(3).mul(constants.DEFAULT_FACTOR);
                await staker.setGroPerBlock(gpb);

                await staker.massUpdatePools([0, 1]);
                const b2 = await web3.eth.getBlockNumber();

                let pi = await staker.poolInfo(0);
                const gpb1 = gpb.mul(ap1).div(ap1.add(ap2));
                expect(pi.accGroPerShare).be.a.bignumber.equal(
                    toBN(b2).sub(toBN(b1)).mul(ACC_GRO_PRECISION).mul(gpb1).div(amount)
                );
                expect(pi.lastRewardBlock).be.a.bignumber.equal(toBN(b2));
                pi = await staker.poolInfo(1);
                expect(pi.accGroPerShare).be.a.bignumber.equal(toBN(0));
                expect(pi.lastRewardBlock).be.a.bignumber.equal(toBN(b2));

                return;
            });
        });

        describe("deposit", function () {
            const ap1 = toBN(1);
            const ap2 = toBN(2);
            const gpb = toBN(3).mul(constants.DEFAULT_FACTOR);

            beforeEach(async function () {
                await staker.setManager(deployer);
                await staker.add(ap1, lpt1.address);
                await staker.add(ap2, lpt2.address);
                await staker.setGroPerBlock(gpb);
            });

            it("revert with invalid pid", async () => {
                return expect(staker.deposit(2, 1)).to.eventually.be.rejected;
            });

            it("zero", async () => {
                await staker.deposit(0, 0);
                await expect(lpt1.balanceOf(staker.address)).to.eventually.be.a.bignumber.equal(toBN(0));
                const ui = await staker.userInfo(0, deployer);
                expect(ui.amount).be.a.bignumber.equal(toBN(0));
                expect(ui.rewardDebt).be.a.bignumber.equal(toBN(0));

                return;
            });

            it("1st deposit", async () => {
                let amount = toBN(10000).mul(constants.DEFAULT_FACTOR);
                await staker.deposit(0, amount);
                let ui = await staker.userInfo(0, deployer);
                expect(ui.amount).be.a.bignumber.equal(amount);
                expect(ui.rewardDebt).be.a.bignumber.equal(toBN(0));
                await expect(lpt1.balanceOf(staker.address)).to.eventually.be.a.bignumber.equal(amount);

                amount = amount.mul(toBN(2));
                await staker.deposit(1, amount);
                ui = await staker.userInfo(1, deployer);
                expect(ui.amount).be.a.bignumber.equal(amount);
                expect(ui.rewardDebt).be.a.bignumber.equal(toBN(0));
                await expect(lpt2.balanceOf(staker.address)).to.eventually.be.a.bignumber.equal(amount);

                return;
            });

            it("2nd deposit", async () => {
                const amount11 = toBN(1000).mul(constants.DEFAULT_FACTOR);
                await staker.deposit(0, amount11);
                const b11 = await web3.eth.getBlockNumber();
                const amount12 = toBN(2000).mul(constants.DEFAULT_FACTOR);
                await staker.deposit(1, amount12);
                const b12 = await web3.eth.getBlockNumber();

                const amount21 = toBN(500).mul(constants.DEFAULT_FACTOR);
                await staker.deposit(0, amount21, {from: dao});
                const b21 = await web3.eth.getBlockNumber();

                const gpb1 = gpb.mul(ap1).div(ap1.add(ap2));
                let ui = await staker.userInfo(0, dao);
                expect(ui.amount).be.a.bignumber.equal(amount21);
                expect(ui.rewardDebt).be.a.bignumber.equal(
                    toBN(b21).sub(toBN(b11)).mul(amount21).mul(gpb1).div(amount11)
                );
                await expect(lpt1.balanceOf(staker.address)).to.eventually.be.a.bignumber.equal(amount11.add(amount21));

                const amount22 = toBN(800).mul(constants.DEFAULT_FACTOR);
                await staker.deposit(1, amount22, {from: dao});
                const b22 = await web3.eth.getBlockNumber();

                const gpb2 = gpb.mul(ap2).div(ap1.add(ap2));
                ui = await staker.userInfo(1, dao);
                expect(ui.amount).be.a.bignumber.equal(amount22);
                expect(ui.rewardDebt).be.a.bignumber.equal(
                    toBN(b22).sub(toBN(b12)).mul(amount22).mul(gpb2).div(amount12)
                );
                await expect(lpt2.balanceOf(staker.address)).to.eventually.be.a.bignumber.equal(amount12.add(amount22));

                return;
            });
        });

        describe("claimable", function () {
            const ap1 = toBN(1);
            const ap2 = toBN(2);
            const gpb = toBN(3).mul(constants.DEFAULT_FACTOR);
            const gpb1 = gpb.mul(ap1).div(ap1.add(ap2));
            const gpb2 = gpb.mul(ap2).div(ap1.add(ap2));

            beforeEach(async function () {
                await staker.setManager(deployer);
                await staker.add(ap1, lpt1.address);
                await staker.add(ap2, lpt2.address);
                await staker.setGroPerBlock(gpb);
            });

            it("zero when no deposit", async () => {
                await expect(staker.claimable(0, deployer)).to.eventually.be.a.bignumber.equal(toBN(0));
                return expect(staker.claimable(1, deployer)).to.eventually.be.a.bignumber.equal(toBN(0));
            });

            it("ok", async () => {
                const amount11 = toBN(1000).mul(constants.DEFAULT_FACTOR);
                await staker.deposit(0, amount11);
                const b1 = toBN(await web3.eth.getBlockNumber());

                await expect(staker.claimable(0, deployer)).to.eventually.be.a.bignumber.equal(toBN(0));

                const amount12 = toBN(2000).mul(constants.DEFAULT_FACTOR);
                await staker.deposit(1, amount12);
                const b2 = toBN(await web3.eth.getBlockNumber());

                await expect(staker.claimable(0, deployer)).to.eventually.be.a.bignumber.equal(b2.sub(b1).mul(gpb1));
                await expect(staker.claimable(1, deployer)).to.eventually.be.a.bignumber.equal(toBN(0));

                const amount21 = toBN(250).mul(constants.DEFAULT_FACTOR);
                await staker.deposit(0, amount21, {from: dao});
                const b3 = toBN(await web3.eth.getBlockNumber());

                await expect(staker.claimable(0, deployer)).to.eventually.be.a.bignumber.equal(b3.sub(b1).mul(gpb1));
                await expect(staker.claimable(1, deployer)).to.eventually.be.a.bignumber.equal(b3.sub(b2).mul(gpb2));
                await expect(staker.claimable(0, dao)).to.eventually.be.a.bignumber.equal(toBN(0));

                let gpb11 = gpb1.mul(amount11).div(amount11.add(amount21));
                let gpb12 = gpb1.mul(amount21).div(amount11.add(amount21));

                const amount22 = toBN(500).mul(constants.DEFAULT_FACTOR);
                await staker.deposit(1, amount22, {from: dao});
                const b4 = toBN(await web3.eth.getBlockNumber());

                await expect(staker.claimable(0, deployer)).to.eventually.be.a.bignumber.equal(
                    b3.sub(b1).mul(gpb1).add(b4.sub(b3).mul(gpb11))
                );
                await expect(staker.claimable(1, deployer)).to.eventually.be.a.bignumber.equal(b4.sub(b2).mul(gpb2));
                await expect(staker.claimable(0, dao)).to.eventually.be.a.bignumber.equal(b4.sub(b3).mul(gpb12));
                await expect(staker.claimable(1, dao)).to.eventually.be.a.bignumber.equal(toBN(0));

                let gpb21 = gpb2.mul(amount12).div(amount12.add(amount22));
                let gpb22 = gpb2.mul(amount22).div(amount12.add(amount22));

                await staker.setManager(deployer);
                const b5 = toBN(await web3.eth.getBlockNumber());

                await expect(staker.claimable(0, deployer)).to.eventually.be.a.bignumber.equal(
                    b3.sub(b1).mul(gpb1).add(b5.sub(b3).mul(gpb11))
                );
                await expect(staker.claimable(1, deployer)).to.eventually.be.a.bignumber.equal(
                    b4.sub(b2).mul(gpb2).add(b5.sub(b4).mul(gpb21))
                );
                await expect(staker.claimable(0, dao)).to.eventually.be.a.bignumber.equal(b5.sub(b3).mul(gpb12));
                await expect(staker.claimable(1, dao)).to.eventually.be.a.bignumber.equal(b5.sub(b4).mul(gpb22));

                await expect(staker.claimable(0, groDeployer)).to.eventually.be.a.bignumber.equal(toBN(0));
                await expect(staker.claimable(1, groDeployer)).to.eventually.be.a.bignumber.equal(toBN(0));

                return;
            });

            it("ok after withdraw", async () => {
                const amount = toBN(1000).mul(constants.DEFAULT_FACTOR);
                await staker.deposit(0, amount);
                const b1 = toBN(await web3.eth.getBlockNumber());

                await staker.withdraw(0, amount);
                const b2 = toBN(await web3.eth.getBlockNumber());

                await expect(staker.claimable(0, deployer)).to.eventually.be.a.bignumber.equal(b2.sub(b1).mul(gpb1));
                expect((await staker.userInfo(0, deployer)).amount).be.a.bignumber.equal(toBN(0));

                await staker.setManager(deployer);
                await staker.setManager(deployer);
                await staker.setManager(deployer);

                await expect(staker.claimable(0, deployer)).to.eventually.be.a.bignumber.equal(b2.sub(b1).mul(gpb1));
                expect((await staker.userInfo(0, deployer)).amount).be.a.bignumber.equal(toBN(0));

                return;
            });
        });

        describe("withdraw & claim", function () {
            const ap1 = toBN(1);
            const ap2 = toBN(2);
            const gpb = toBN(3).mul(constants.DEFAULT_FACTOR);
            const gpb1 = gpb.mul(ap1).div(ap1.add(ap2));
            const gpb2 = gpb.mul(ap2).div(ap1.add(ap2));

            beforeEach(async function () {
                await staker.setManager(deployer);
                await staker.add(ap1, lpt1.address);
                await staker.add(ap2, lpt2.address);
                await staker.setGroPerBlock(gpb);
            });

            it("claim revert with invalid pid", async () => {
                return expect(staker.claim(2)).to.eventually.be.rejected;
            });

            it("withdraw revert with invalid pid", async () => {
                return expect(staker.withdraw(2, 0)).to.eventually.be.rejected;
            });

            it("withdraw revert when withdrawal amount > staked amount", async () => {
                return expect(staker.withdraw(0, 1)).to.eventually.be.rejected;
            });

            it("withdrawAndClaim revert with invalid pid", async () => {
                return expect(staker.withdrawAndClaim(2, 0)).to.eventually.be.rejected;
            });

            it("withdrawAndClaim revert when withdrawal amount > staked amount", async () => {
                return expect(staker.withdrawAndClaim(0, 1)).to.eventually.be.rejected;
            });

            it("zero claim", async () => {
                await staker.claim(true, 0);
                await expect(groVest.totalBalance(deployer)).to.eventually.be.a.bignumber.equal(toBN(0));
                await staker.claim(true, 1);
                await expect(groVest.totalBalance(deployer)).to.eventually.be.a.bignumber.equal(toBN(0));
                return;
            });

            it("zero withdraw", async () => {
                const amount = toBN(1000).mul(constants.DEFAULT_FACTOR);
                await staker.deposit(0, amount);

                await staker.withdraw(0, 0);
                await expect(lpt1.balanceOf(staker.address)).to.eventually.be.a.bignumber.equal(amount);
                const ui = await staker.userInfo(0, deployer);
                expect(ui.amount).be.a.bignumber.equal(amount);

                return;
            });

            it("zero withdrawAndClaim", async () => {
                const amount = toBN(1000).mul(constants.DEFAULT_FACTOR);
                await staker.deposit(0, amount);

                await staker.withdrawAndClaim(true, 0, 0);
                await expect(lpt1.balanceOf(staker.address)).to.eventually.be.a.bignumber.equal(amount);
                const ui = await staker.userInfo(0, deployer);
                expect(ui.amount).be.a.bignumber.equal(amount);

                return;
            });

            it("ok", async () => {
                const amount11 = toBN(1000).mul(constants.DEFAULT_FACTOR);
                await staker.deposit(0, amount11);
                let b1 = toBN(await web3.eth.getBlockNumber());

                const amount12 = toBN(2000).mul(constants.DEFAULT_FACTOR);
                await staker.deposit(1, amount12);
                let b2 = toBN(await web3.eth.getBlockNumber());

                await staker.setManager(deployer);
                await staker.setManager(deployer);
                await staker.setManager(deployer);

                await staker.multiClaim(true, [0, 1]);
                const b21 = toBN(await web3.eth.getBlockNumber());
                let tb1 = await groVest.totalBalance(deployer);
                expect(tb1).be.a.bignumber.equal(b21.sub(b1).mul(gpb1).add(b21.sub(b2).mul(gpb2)));
                b1 = b21;
                b2 = b21;

                await staker.setManager(deployer);

                await staker.claim(true, 0);
                const b3 = toBN(await web3.eth.getBlockNumber());
                await expect(groVest.totalBalance(deployer)).to.eventually.be.a.bignumber.equal(
                    tb1.add(b3.sub(b1).mul(gpb1))
                );
                tb1 = await groVest.totalBalance(deployer);

                const amount21 = toBN(250).mul(constants.DEFAULT_FACTOR);
                await staker.deposit(0, amount21, {from: dao});
                let b4 = toBN(await web3.eth.getBlockNumber());

                let gpb11 = gpb1.mul(amount11).div(amount11.add(amount21));
                let gpb12 = gpb1.mul(amount21).div(amount11.add(amount21));

                await staker.claim(true, 0);
                const b5 = toBN(await web3.eth.getBlockNumber());
                await expect(groVest.totalBalance(deployer)).to.eventually.be.a.bignumber.equal(
                    tb1.add(b4.sub(b3).mul(gpb1).add(b5.sub(b4).mul(gpb11)))
                );
                tb1 = await groVest.totalBalance(deployer);

                await staker.withdraw(1, amount12);
                const b6 = toBN(await web3.eth.getBlockNumber());
                await expect(lpt2.balanceOf(staker.address)).to.eventually.be.a.bignumber.equal(toBN(0));

                const amount22 = toBN(500).mul(constants.DEFAULT_FACTOR);
                await staker.deposit(1, amount22, {from: dao});
                let b7 = toBN(await web3.eth.getBlockNumber());

                await staker.setManager(deployer);
                await staker.setManager(deployer);
                await staker.setManager(deployer);

                await staker.multiClaim(true, [0, 1], {from: dao});
                const b71 = toBN(await web3.eth.getBlockNumber());
                let tb2 = await groVest.totalBalance(dao);
                expect(tb2).be.a.bignumber.equal(b71.sub(b4).mul(gpb12).add(b71.sub(b7).mul(gpb2)));
                b4 = b71;
                b7 = b71;

                await staker.setManager(deployer);

                await staker.claim(true, 0);
                const b8 = toBN(await web3.eth.getBlockNumber());
                await expect(groVest.totalBalance(deployer)).to.eventually.be.a.bignumber.equal(
                    tb1.add(b8.sub(b5).mul(gpb11))
                );
                tb1 = await groVest.totalBalance(deployer);

                await staker.withdrawAndClaim(true, 0, amount21, {from: dao});
                const b9 = toBN(await web3.eth.getBlockNumber());
                await expect(groVest.totalBalance(dao)).to.eventually.be.a.bignumber.equal(
                    tb2.add(b9.sub(b4).mul(gpb12))
                );
                tb2 = await groVest.totalBalance(dao);
                await expect(lpt1.balanceOf(staker.address)).to.eventually.be.a.bignumber.equal(amount11);

                await staker.claim(true, 1);
                const b10 = toBN(await web3.eth.getBlockNumber());
                await expect(groVest.totalBalance(deployer)).to.eventually.be.a.bignumber.equal(
                    tb1.add(b6.sub(b2).mul(gpb2))
                );
                tb1 = await groVest.totalBalance(deployer);

                await staker.claim(true, 1, {from: dao});
                const b11 = toBN(await web3.eth.getBlockNumber());
                await expect(groVest.totalBalance(dao)).to.eventually.be.a.bignumber.equal(
                    tb2.add(b11.sub(b7).mul(gpb2))
                );
                tb2 = await groVest.totalBalance(dao);

                await staker.multiWithdrawAndClaim(true, [0, 1], [amount11, 0]);
                const b12 = toBN(await web3.eth.getBlockNumber());
                await expect(groVest.totalBalance(deployer)).to.eventually.be.a.bignumber.equal(
                    tb1.add(b9.sub(b8).mul(gpb11)).add(b12.sub(b9).mul(gpb1))
                );
                tb1 = await groVest.totalBalance(deployer);
                await expect(lpt1.balanceOf(staker.address)).to.eventually.be.a.bignumber.equal(toBN(0));

                await staker.multiWithdraw([0, 1], [0, amount22], {from: dao});
                const b13 = toBN(await web3.eth.getBlockNumber());
                await expect(lpt2.balanceOf(staker.address)).to.eventually.be.a.bignumber.equal(toBN(0));

                await staker.claim(true, 1, {from: dao});
                const b14 = toBN(await web3.eth.getBlockNumber());
                await expect(groVest.totalBalance(dao)).to.eventually.be.a.bignumber.equal(
                    tb2.add(b13.sub(b11).mul(gpb2))
                );
                tb2 = await groVest.totalBalance(dao);

                return;
            });

            it("multiWithdrawAndClaim", async () => {
                const amount1 = toBN(10000).mul(constants.DEFAULT_FACTOR);
                await staker.deposit(0, amount1);
                const b1 = toBN(await web3.eth.getBlockNumber());

                const amount2 = toBN(20000).mul(constants.DEFAULT_FACTOR);
                await staker.deposit(1, amount2);
                const b2 = toBN(await web3.eth.getBlockNumber());

                const before1 = await lpt1.balanceOf(deployer);
                const before2 = await lpt2.balanceOf(deployer);
                await staker.multiWithdrawAndClaim(true, [0, 1], [amount1, amount2]);
                const b3 = toBN(await web3.eth.getBlockNumber());
                const tb = await groVest.totalBalance(deployer);
                expect(tb).to.be.a.bignumber.equal(b3.sub(b1).mul(gpb1).add(b3.sub(b2).mul(gpb2)));
                await expect(lpt1.balanceOf(deployer)).to.eventually.be.a.bignumber.equal(before1.add(amount1));
                await expect(lpt2.balanceOf(deployer)).to.eventually.be.a.bignumber.equal(before2.add(amount2));

                return;
            });

            it("multiWithdraw", async () => {
                const amount1 = toBN(10000).mul(constants.DEFAULT_FACTOR);
                await staker.deposit(0, amount1);
                const b1 = toBN(await web3.eth.getBlockNumber());

                const amount2 = toBN(20000).mul(constants.DEFAULT_FACTOR);
                await staker.deposit(1, amount2);
                const b2 = toBN(await web3.eth.getBlockNumber());

                const before1 = await lpt1.balanceOf(deployer);
                const before2 = await lpt2.balanceOf(deployer);
                await staker.multiWithdraw([0, 1], [amount1, amount2]);
                const b3 = toBN(await web3.eth.getBlockNumber());
                await expect(lpt1.balanceOf(deployer)).to.eventually.be.a.bignumber.equal(before1.add(amount1));
                await expect(lpt2.balanceOf(deployer)).to.eventually.be.a.bignumber.equal(before2.add(amount2));

                await staker.multiClaim(true, [0, 1]);
                const tb = await groVest.totalBalance(deployer);
                expect(tb).to.be.a.bignumber.equal(b3.sub(b1).mul(gpb1).add(b3.sub(b2).mul(gpb2)));

                return;
            });
        });

        describe("emergencyWithdraw", function () {
            beforeEach(async function () {
                await staker.setManager(deployer);
                await staker.add(1, lpt1.address);
                await staker.add(2, lpt2.address);
                await staker.setGroPerBlock(toBN(3).mul(constants.DEFAULT_FACTOR));
            });

            it("zero", async () => {
                await staker.emergencyWithdraw(0);
                return;
            });

            it("ok", async () => {
                const amount = toBN(1000).mul(constants.DEFAULT_FACTOR);
                await staker.deposit(0, amount);

                const ua1 = await lpt1.balanceOf(deployer);
                await staker.emergencyWithdraw(0);
                await expect(lpt1.balanceOf(staker.address)).to.eventually.be.a.bignumber.equal(toBN(0));
                const ui = await staker.userInfo(0, deployer);
                expect(ui.amount).be.a.bignumber.equal(toBN(0));
                expect(ui.rewardDebt).be.a.bignumber.equal(toBN(0));
                await expect(lpt1.balanceOf(deployer)).to.eventually.be.a.bignumber.equal(ua1.add(amount));

                return;
            });
        });

        describe("migrate", function () {
            const ap1 = toBN(1);
            const ap2 = toBN(2);
            const gpb = toBN(3).mul(constants.DEFAULT_FACTOR);
            const gpb1 = gpb.mul(ap1).div(ap1.add(ap2));
            const gpb2 = gpb.mul(ap2).div(ap1.add(ap2));

            beforeEach(async function () {
                await staker.setManager(deployer);
                await staker.add(1, lpt1.address);
                await staker.add(2, lpt2.address);
                await staker.setGroPerBlock(gpb);
            });

            it("migrate revert !timelock", async () => {
                return expect(staker.migrate([0], {from: dao})).to.eventually.be.rejectedWith("msg.sender != timelock");
            });

            it("migrate revert !newStaker", async () => {
                return expect(staker.migrate([0], {from: timeLock})).to.eventually.be.rejectedWith(
                    "migrate: !newStaker"
                );
            });

            it("migrateFrom revert !oldStaker", async () => {
                return expect(staker.migrateFrom([0])).to.eventually.be.rejectedWith("migrateFrom: !oldStaker");
            });

            it("migrateUser revert !oldStaker", async () => {
                return expect(staker.migrateUser(constants.ZERO_ADDRESS, [0])).to.eventually.be.rejectedWith(
                    "migrateUser: !oldStaker"
                );
            });

            it("migrate ok", async () => {
                const amount1 = toBN(10000).mul(constants.DEFAULT_FACTOR);
                await staker.deposit(0, amount1);
                const amount2 = toBN(20000).mul(constants.DEFAULT_FACTOR);
                await staker.deposit(1, amount2);

                await staker.setStatus(true, {from: timeLock});

                const newStaker = await LPTokenStaker.new(timeLock);
                await newStaker.setOldStaker(staker.address);
                await staker.setNewStaker(newStaker.address);
                await staker.migrate([0, 1], {from: timeLock});

                expect(await staker.totalAllocPoint()).to.deep.equal(await newStaker.totalAllocPoint());
                expect(await staker.poolInfo(0)).to.deep.equal(await newStaker.poolInfo(0));
                expect(await staker.poolInfo(1)).to.deep.equal(await newStaker.poolInfo(1));
                expect(await staker.poolLength()).to.deep.equal(await newStaker.poolLength());
                expect(await newStaker.activeLpTokens(lpt1.address)).to.equal(true);
                expect(await newStaker.activeLpTokens(lpt2.address)).to.equal(true);

                await expect(lpt1.balanceOf(staker.address)).to.eventually.be.a.bignumber.equal(toBN(0));
                await expect(lpt2.balanceOf(staker.address)).to.eventually.be.a.bignumber.equal(toBN(0));
                await expect(lpt1.balanceOf(newStaker.address)).to.eventually.be.a.bignumber.equal(amount1);
                await expect(lpt2.balanceOf(newStaker.address)).to.eventually.be.a.bignumber.equal(amount2);

                return;
            });

            async function redeployStaker() {
                // disable old staker

                await staker.setStatus(true, {from: timeLock});

                await expect(staker.deposit(0, 1)).to.eventually.be.rejectedWith("deposit: paused");
                await expect(staker.deposit(1, 1)).to.eventually.be.rejectedWith("deposit: paused");
                await expect(staker.withdraw(0, 1)).to.eventually.be.rejectedWith("withdraw: paused");
                await expect(staker.withdraw(1, 1)).to.eventually.be.rejectedWith("withdraw: paused");
                await expect(staker.multiWithdraw([0, 1], [1, 1])).to.eventually.be.rejectedWith(
                    "multiWithdraw: paused"
                );
                await expect(staker.claim(true, 0)).to.eventually.be.rejectedWith("claim: paused");
                await expect(staker.claim(true, 1)).to.eventually.be.rejectedWith("claim: paused");
                await expect(staker.multiClaim(true, [0, 1])).to.eventually.be.rejectedWith("multiClaim: paused");
                await expect(staker.withdrawAndClaim(true, 0, 1)).to.eventually.be.rejectedWith(
                    "withdrawAndClaim: paused"
                );
                await expect(staker.withdrawAndClaim(true, 1, 1)).to.eventually.be.rejectedWith(
                    "withdrawAndClaim: paused"
                );
                await expect(staker.multiWithdrawAndClaim(true, [0, 1], [1, 1])).to.eventually.be.rejectedWith(
                    "multiWithdrawAndClaim: paused"
                );

                const newStaker = await LPTokenStaker.new(timeLock);
                await groVest.setVester(newStaker.address, true);
                await lpt1.approve(newStaker.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR));
                await lpt2.approve(newStaker.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR));
                await lpt1.approve(newStaker.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR), {from: dao});
                await lpt2.approve(newStaker.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR), {from: dao});
                await newStaker.setOldStaker(staker.address);
                await staker.setNewStaker(newStaker.address);
                await staker.migrate([0, 1], {from: timeLock});

                await newStaker.setVesting(await staker.vesting());
                await newStaker.setManager(await staker.manager());
                await newStaker.setMaxGroPerBlock(await staker.maxGroPerBlock());
                await newStaker.setGroPerBlock(await staker.groPerBlock());

                await newStaker.setStatus(false, {from: timeLock});

                return newStaker;
            }

            it("migrateUser case1", async () => {
                // deposit ->
                // withdraw <-
                // claim -->
                // withdraw & claim <--
                // migrate >>
                // migrateUser ->>

                // deployer -> staker p0 10000
                // deployer -> staker p1 20000
                // staker >> newStaker
                // deployer ->> staker newStaker
                // deployer --> newStaker [p0, p1]
                // dao -> newStaker p1 20000
                // deployer <-- newStaker p0 10000
                // deployer -> newStaker p1 40000
                // deployer --> newStaker [p0, p1]
                // deployer <-- newStaker p1 60000

                const amount1 = toBN(10000).mul(constants.DEFAULT_FACTOR);
                await staker.deposit(0, amount1);
                const b1 = toBN(await web3.eth.getBlockNumber());
                const amount2 = toBN(20000).mul(constants.DEFAULT_FACTOR);
                await staker.deposit(1, amount2);
                const b2 = toBN(await web3.eth.getBlockNumber());

                const newStaker = await redeployStaker();

                await newStaker.migrateUser(deployer, [0, 1]);
                await expect(newStaker.migrateUser(deployer, [0, 1])).to.eventually.be.rejectedWith(
                    "migrateUser: pid already done"
                );

                await newStaker.multiClaim(true, [0, 1]);
                const b3 = toBN(await web3.eth.getBlockNumber());
                let tb1 = await groVest.totalBalance(deployer);
                expect(tb1).to.be.a.bignumber.equal(b3.sub(b1).mul(gpb1).add(b3.sub(b2).mul(gpb2)));

                const amount3 = toBN(20000).mul(constants.DEFAULT_FACTOR);
                await newStaker.deposit(1, amount3, {from: dao});
                const b4 = toBN(await web3.eth.getBlockNumber());
                let c12 = b4.sub(b3).mul(gpb2);
                let gpb21 = gpb2.mul(amount2).div(amount2.add(amount3));

                let balanceBefore = await lpt1.balanceOf(deployer);
                await newStaker.multiWithdrawAndClaim(true, [0], [amount1]);
                const b5 = toBN(await web3.eth.getBlockNumber());
                await expect(groVest.totalBalance(deployer)).to.eventually.be.a.bignumber.equal(
                    tb1.add(b5.sub(b3).mul(gpb1))
                );
                tb1 = await groVest.totalBalance(deployer);
                let balanceAfter = await lpt1.balanceOf(deployer);
                expect(balanceAfter.sub(balanceBefore)).to.be.a.bignumber.equal(amount1);

                const amount4 = toBN(40000).mul(constants.DEFAULT_FACTOR);
                await newStaker.deposit(1, amount4);
                const b6 = toBN(await web3.eth.getBlockNumber());
                c12 = c12.add(b6.sub(b4).mul(gpb21));
                let amount12 = amount2.add(amount4);
                gpb21 = gpb2.mul(amount12).div(amount12.add(amount3));

                await newStaker.setManager(deployer);

                await newStaker.multiClaim(true, [0, 1]);
                const b7 = toBN(await web3.eth.getBlockNumber());
                c12 = c12.add(b7.sub(b6).mul(gpb21));
                await expect(groVest.totalBalance(deployer)).to.eventually.be.a.bignumber.equal(tb1.add(c12));
                tb1 = await groVest.totalBalance(deployer);

                balanceBefore = await lpt2.balanceOf(deployer);
                await newStaker.withdrawAndClaim(true, 1, amount12);
                const b8 = toBN(await web3.eth.getBlockNumber());
                c12 = b8.sub(b7).mul(gpb21);
                await expect(groVest.totalBalance(deployer)).to.eventually.be.a.bignumber.equal(tb1.add(c12));
                tb1 = await groVest.totalBalance(deployer);
                balanceAfter = await lpt2.balanceOf(deployer);
                expect(balanceAfter.sub(balanceBefore)).to.be.a.bignumber.equal(amount12);

                return;
            });

            it("migrateUser case2", async () => {
                // deployer -> staker p0 10000
                // deployer -> staker p1 20000
                // staker >> newStaker
                // dao -> newStaker p1 20000
                // deployer -> newStaker p1 40000
                // deployer ->> staker newStaker
                // deployer --> newStaker [p0, p1]
                // dao <-- newStaker p0 20000

                const amount1 = toBN(10000).mul(constants.DEFAULT_FACTOR);
                await staker.deposit(0, amount1);
                const b1 = toBN(await web3.eth.getBlockNumber());
                const amount2 = toBN(20000).mul(constants.DEFAULT_FACTOR);
                await staker.deposit(1, amount2);
                const b2 = toBN(await web3.eth.getBlockNumber());

                const newStaker = await redeployStaker();

                const amount3 = toBN(20000).mul(constants.DEFAULT_FACTOR);
                await newStaker.deposit(1, amount3, {from: dao});
                const b4 = toBN(await web3.eth.getBlockNumber());
                let c12 = b4.sub(b2).mul(gpb2);
                let gpb21 = gpb2.mul(amount2).div(amount2.add(amount3));
                let gpb22 = gpb2.mul(amount3).div(amount2.add(amount3));

                const amount4 = toBN(40000).mul(constants.DEFAULT_FACTOR);
                await newStaker.deposit(1, amount4);
                const b5 = toBN(await web3.eth.getBlockNumber());
                c12 = c12.add(b5.sub(b4).mul(gpb21));
                let c22 = b5.sub(b4).mul(gpb22);
                let amount12 = amount2.add(amount4);
                gpb21 = gpb2.mul(amount12).div(amount12.add(amount3));
                gpb22 = gpb2.mul(amount3).div(amount12.add(amount3));

                await newStaker.migrateUser(deployer, [0, 1]);
                await expect(newStaker.migrateUser(deployer, [0, 1])).to.eventually.be.rejectedWith(
                    "migrateUser: pid already done"
                );

                await newStaker.multiClaim(true, [0, 1]);
                const b6 = toBN(await web3.eth.getBlockNumber());
                c12 = c12.add(b6.sub(b5).mul(gpb21));
                c22 = c22.add(b6.sub(b5).mul(gpb22));
                let tb1 = await groVest.totalBalance(deployer);
                expect(tb1).to.be.a.bignumber.equal(b6.sub(b1).mul(gpb1).add(c12));

                let balanceBefore = await lpt2.balanceOf(dao);
                await newStaker.withdrawAndClaim(true, 1, amount2, {from: dao});
                const b7 = toBN(await web3.eth.getBlockNumber());
                let tb2 = await groVest.totalBalance(dao);
                expect(tb2).to.be.a.bignumber.equal(c22.add(b7.sub(b6).mul(gpb22)));
                let balanceAfter = await lpt2.balanceOf(dao);
                expect(balanceAfter.sub(balanceBefore)).to.be.a.bignumber.equal(amount2);

                return;
            });
        });
    });

    describe("migrate from V1", function () {
        const ap1 = toBN(1);
        const ap2 = toBN(2);
        const gpb = toBN(3).mul(constants.DEFAULT_FACTOR);
        const gpb1 = gpb.mul(ap1).div(ap1.add(ap2));
        const gpb2 = gpb.mul(ap2).div(ap1.add(ap2));

        async function redeployStaker() {
            let oldGroPerBlock = await staker.groPerBlock();
            let oldPoolAllocations = [];
            oldPoolAllocations[0] = (await staker.poolInfo(0)).allocPoint;
            oldPoolAllocations[1] = (await staker.poolInfo(1)).allocPoint;

            // disable old staker

            await staker.set(0, 0);
            await staker.set(1, 0);

            await expect(staker.deposit(0, 1)).to.eventually.be.rejectedWith("updatePool: totalAllocPoint == 0");
            await expect(staker.deposit(1, 1)).to.eventually.be.rejectedWith("updatePool: totalAllocPoint == 0");
            await expect(staker.withdraw(0, 1)).to.eventually.be.rejectedWith("updatePool: totalAllocPoint == 0");
            await expect(staker.withdraw(1, 1)).to.eventually.be.rejectedWith("updatePool: totalAllocPoint == 0");
            await expect(staker.claim(0)).to.eventually.be.rejectedWith("updatePool: totalAllocPoint == 0");
            await expect(staker.claim(1)).to.eventually.be.rejectedWith("updatePool: totalAllocPoint == 0");
            await expect(staker.withdrawAndClaim(0, 1)).to.eventually.be.rejectedWith(
                "updatePool: totalAllocPoint == 0"
            );
            await expect(staker.withdrawAndClaim(1, 1)).to.eventually.be.rejectedWith(
                "updatePool: totalAllocPoint == 0"
            );

            const newStaker = await LPTokenStaker.new(timeLock);
            await groVest.setVester(newStaker.address, true);
            await lpt1.approve(newStaker.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR));
            await lpt2.approve(newStaker.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR));
            await lpt1.approve(newStaker.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR), {from: dao});
            await lpt2.approve(newStaker.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR), {from: dao});
            await newStaker.setOldStaker(staker.address);
            await newStaker.migrateFromV1();
            await expect(newStaker.migrateFromV1()).to.eventually.be.rejectedWith("migrateFromV1: already done");
            await newStaker.setVesting(groVest.address);
            await newStaker.setGroPerBlock(oldGroPerBlock);
            await newStaker.set(0, oldPoolAllocations[0]);
            await newStaker.set(1, oldPoolAllocations[1]);

            const mockLPT1 = await MockToken.new("MockLPT1", "MockLPT1");
            const mockLPT2 = await MockToken.new("MockLPT2", "MockLPT2");
            const migrator = await MockMigrator.new(
                staker.address,
                newStaker.address,
                [lpt1.address, lpt2.address],
                [mockLPT1.address, mockLPT2.address]
            );
            await staker.setMigrator(migrator.address);
            await mockLPT1.mint(migrator.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR));
            await mockLPT2.mint(migrator.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR));

            await staker.migrate(0);
            await staker.migrate(1);

            await newStaker.setStatus(false, {from: timeLock});

            return newStaker;
        }

        beforeEach(async function () {
            gro = await GROToken.new("GRO", "GRO", INIT_MAX_TOTAL_SUPPLY, NON_INFLATION_PERIOD, {from: groDeployer});
            groVest = await GROVesting.new(constants.ZERO_ADDRESS, timeLock);
            vesters = [dao, deployer, groDeployer, groVest.address];
            groDist = await GRODistributer.new(gro.address, vesters, burner);
            await gro.setDistributer(groDist.address, {from: groDeployer});
            await groVest.setDistributer(groDist.address);
            await gro.setDistributer(groDist.address, {from: groDeployer});

            await groVest.setVester(deployer, true);
            staker = await LPTokenStakerV1.new();
            await staker.setVesting(groVest.address);
            await groVest.setVester(staker.address, true);
            await groVest.setStatus(false, {from: timeLock});

            await staker.setMaxGroPerBlock(toBN(10000).mul(constants.DEFAULT_FACTOR));

            lpt1 = await MockToken.new("LPT1", "LPT1");
            lpt2 = await MockToken.new("LPT2", "LPT2");

            await lpt1.mint(deployer, toBN(1_000_000).mul(constants.DEFAULT_FACTOR));
            await lpt2.mint(deployer, toBN(1_000_000).mul(constants.DEFAULT_FACTOR));
            await lpt1.approve(staker.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR));
            await lpt2.approve(staker.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR));

            await lpt1.mint(dao, toBN(1_000_000).mul(constants.DEFAULT_FACTOR));
            await lpt2.mint(dao, toBN(1_000_000).mul(constants.DEFAULT_FACTOR));
            await lpt1.approve(staker.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR), {from: dao});
            await lpt2.approve(staker.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR), {from: dao});

            await staker.setManager(deployer);
            await staker.add(1, lpt1.address);
            await staker.add(2, lpt2.address);
            await staker.setGroPerBlock(gpb);
        });

        it("migrateFromV1 ok", async () => {
            const amount1 = toBN(10000).mul(constants.DEFAULT_FACTOR);
            await staker.deposit(0, amount1);
            const amount2 = toBN(20000).mul(constants.DEFAULT_FACTOR);
            await staker.deposit(1, amount2);

            // disable old staker
            await staker.set(0, 0);
            await staker.set(1, 0);

            await expect(staker.deposit(0, 1)).to.eventually.be.rejectedWith("updatePool: totalAllocPoint == 0");
            await expect(staker.deposit(1, 1)).to.eventually.be.rejectedWith("updatePool: totalAllocPoint == 0");
            await expect(staker.withdraw(0, 1)).to.eventually.be.rejectedWith("updatePool: totalAllocPoint == 0");
            await expect(staker.withdraw(1, 1)).to.eventually.be.rejectedWith("updatePool: totalAllocPoint == 0");
            await expect(staker.claim(0)).to.eventually.be.rejectedWith("updatePool: totalAllocPoint == 0");
            await expect(staker.claim(1)).to.eventually.be.rejectedWith("updatePool: totalAllocPoint == 0");
            await expect(staker.withdrawAndClaim(0, 1)).to.eventually.be.rejectedWith(
                "updatePool: totalAllocPoint == 0"
            );
            await expect(staker.withdrawAndClaim(1, 1)).to.eventually.be.rejectedWith(
                "updatePool: totalAllocPoint == 0"
            );

            const newStaker = await LPTokenStaker.new(timeLock);
            await newStaker.setOldStaker(staker.address);
            await newStaker.migrateFromV1();

            expect(await staker.manager()).to.equal(await newStaker.manager());
            expect(await staker.maxGroPerBlock()).to.deep.equal(await newStaker.maxGroPerBlock());
            expect(await staker.poolInfo(0)).to.deep.equal(await newStaker.poolInfo(0));
            expect(await staker.poolInfo(1)).to.deep.equal(await newStaker.poolInfo(1));
            expect(await staker.poolLength()).to.deep.equal(await newStaker.poolLength());
            expect(await newStaker.activeLpTokens(lpt1.address)).to.equal(true);
            expect(await newStaker.activeLpTokens(lpt2.address)).to.equal(true);

            const mockLPT1 = await MockToken.new("MockLPT1", "MockLPT1");
            const mockLPT2 = await MockToken.new("MockLPT2", "MockLPT2");
            const migrator = await MockMigrator.new(
                staker.address,
                newStaker.address,
                [lpt1.address, lpt2.address],
                [mockLPT1.address, mockLPT2.address]
            );
            await staker.setMigrator(migrator.address);
            await mockLPT1.mint(migrator.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR));
            await mockLPT2.mint(migrator.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR));

            await staker.migrate(0);
            await staker.migrate(1);

            await expect(lpt1.balanceOf(staker.address)).to.eventually.be.a.bignumber.equal(toBN(0));
            await expect(lpt2.balanceOf(staker.address)).to.eventually.be.a.bignumber.equal(toBN(0));
            await expect(lpt1.balanceOf(newStaker.address)).to.eventually.be.a.bignumber.equal(amount1);
            await expect(lpt2.balanceOf(newStaker.address)).to.eventually.be.a.bignumber.equal(amount2);

            return;
        });

        it("migrateUser case1", async () => {
            // deposit ->
            // withdraw <-
            // claim -->
            // withdraw & claim <--
            // migrate >>
            // migrateUser ->>

            // deployer -> staker p0 10000
            // deployer -> staker p1 20000
            // staker >> newStaker
            // deployer ->> staker newStaker
            // deployer --> newStaker [p0, p1]
            // dao -> newStaker p1 20000
            // deployer <-- newStaker p0 10000
            // deployer -> newStaker p1 40000
            // deployer --> newStaker [p0, p1]
            // deployer <-- newStaker p1 60000

            const amount1 = toBN(10000).mul(constants.DEFAULT_FACTOR);
            await staker.deposit(0, amount1);
            const b1 = toBN(await web3.eth.getBlockNumber());
            const amount2 = toBN(20000).mul(constants.DEFAULT_FACTOR);
            await staker.deposit(1, amount2);
            const b2 = toBN(await web3.eth.getBlockNumber());

            const newStaker = await redeployStaker();

            await newStaker.migrateUser(deployer, [0, 1]);
            await expect(newStaker.migrateUser(deployer, [0, 1])).to.eventually.be.rejectedWith(
                "migrateUser: pid already done"
            );

            await newStaker.multiClaim(true, [0, 1]);
            const b3 = toBN(await web3.eth.getBlockNumber());
            let tb1 = await groVest.totalBalance(deployer);
            expect(tb1).to.be.a.bignumber.equal(b3.sub(b1).mul(gpb1).add(b3.sub(b2).mul(gpb2)));

            const amount3 = toBN(20000).mul(constants.DEFAULT_FACTOR);
            await newStaker.deposit(1, amount3, {from: dao});
            const b4 = toBN(await web3.eth.getBlockNumber());
            let c12 = b4.sub(b3).mul(gpb2);
            let gpb21 = gpb2.mul(amount2).div(amount2.add(amount3));

            let balanceBefore = await lpt1.balanceOf(deployer);
            await newStaker.multiWithdrawAndClaim(true, [0], [amount1]);
            const b5 = toBN(await web3.eth.getBlockNumber());
            await expect(groVest.totalBalance(deployer)).to.eventually.be.a.bignumber.equal(
                tb1.add(b5.sub(b3).mul(gpb1))
            );
            tb1 = await groVest.totalBalance(deployer);
            let balanceAfter = await lpt1.balanceOf(deployer);
            expect(balanceAfter.sub(balanceBefore)).to.be.a.bignumber.equal(amount1);

            const amount4 = toBN(40000).mul(constants.DEFAULT_FACTOR);
            await newStaker.deposit(1, amount4);
            const b6 = toBN(await web3.eth.getBlockNumber());
            c12 = c12.add(b6.sub(b4).mul(gpb21));
            let amount12 = amount2.add(amount4);
            gpb21 = gpb2.mul(amount12).div(amount12.add(amount3));

            await newStaker.setManager(deployer);

            await newStaker.multiClaim(true, [0, 1]);
            const b7 = toBN(await web3.eth.getBlockNumber());
            c12 = c12.add(b7.sub(b6).mul(gpb21));
            await expect(groVest.totalBalance(deployer)).to.eventually.be.a.bignumber.equal(tb1.add(c12));
            tb1 = await groVest.totalBalance(deployer);

            balanceBefore = await lpt2.balanceOf(deployer);
            await newStaker.withdrawAndClaim(true, 1, amount12);
            const b8 = toBN(await web3.eth.getBlockNumber());
            c12 = b8.sub(b7).mul(gpb21);
            await expect(groVest.totalBalance(deployer)).to.eventually.be.a.bignumber.equal(tb1.add(c12));
            tb1 = await groVest.totalBalance(deployer);
            balanceAfter = await lpt2.balanceOf(deployer);
            expect(balanceAfter.sub(balanceBefore)).to.be.a.bignumber.equal(amount12);

            return;
        });

        it("migrateUser case2", async () => {
            // deployer -> staker p0 10000
            // deployer -> staker p1 20000
            // staker >> newStaker
            // dao -> newStaker p1 20000
            // deployer -> newStaker p1 40000
            // deployer ->> staker newStaker
            // deployer --> newStaker [p0, p1]
            // dao <-- newStaker p0 20000

            const amount1 = toBN(10000).mul(constants.DEFAULT_FACTOR);
            await staker.deposit(0, amount1);
            const b1 = toBN(await web3.eth.getBlockNumber());
            const amount2 = toBN(20000).mul(constants.DEFAULT_FACTOR);
            await staker.deposit(1, amount2);
            const b2 = toBN(await web3.eth.getBlockNumber());

            const newStaker = await redeployStaker();

            const amount3 = toBN(20000).mul(constants.DEFAULT_FACTOR);
            await newStaker.deposit(1, amount3, {from: dao});
            const b4 = toBN(await web3.eth.getBlockNumber());
            let c12 = b4.sub(b2).mul(gpb2);
            let gpb21 = gpb2.mul(amount2).div(amount2.add(amount3));
            let gpb22 = gpb2.mul(amount3).div(amount2.add(amount3));

            const amount4 = toBN(40000).mul(constants.DEFAULT_FACTOR);
            await newStaker.deposit(1, amount4);
            const b5 = toBN(await web3.eth.getBlockNumber());
            c12 = c12.add(b5.sub(b4).mul(gpb21));
            let c22 = b5.sub(b4).mul(gpb22);
            let amount12 = amount2.add(amount4);
            gpb21 = gpb2.mul(amount12).div(amount12.add(amount3));
            gpb22 = gpb2.mul(amount3).div(amount12.add(amount3));

            await newStaker.migrateUser(deployer, [0, 1]);
            await expect(newStaker.migrateUser(deployer, [0, 1])).to.eventually.be.rejectedWith(
                "migrateUser: pid already done"
            );

            await newStaker.multiClaim(true, [0, 1]);
            const b6 = toBN(await web3.eth.getBlockNumber());
            c12 = c12.add(b6.sub(b5).mul(gpb21));
            c22 = c22.add(b6.sub(b5).mul(gpb22));
            let tb1 = await groVest.totalBalance(deployer);
            expect(tb1).to.be.a.bignumber.equal(b6.sub(b1).mul(gpb1).add(c12));

            let balanceBefore = await lpt2.balanceOf(dao);
            await newStaker.withdrawAndClaim(true, 1, amount2, {from: dao});
            const b7 = toBN(await web3.eth.getBlockNumber());
            let tb2 = await groVest.totalBalance(dao);
            expect(tb2).to.be.a.bignumber.equal(c22.add(b7.sub(b6).mul(gpb22)));
            let balanceAfter = await lpt2.balanceOf(dao);
            expect(balanceAfter.sub(balanceBefore)).to.be.a.bignumber.equal(amount2);

            return;
        });
    });
});
