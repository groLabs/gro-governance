const {toBN} = require("web3-utils");
const GROToken = artifacts.require("GROToken");
const GRODistributer = artifacts.require("GRODistributer");
const GROVesting = artifacts.require("GROVesting");
const MockVesting = artifacts.require("MockVesting");
const MockBonus = artifacts.require("MockBonus");
const GROHodler = artifacts.require("GROHodler");
const GROHodlerV1 = artifacts.require("GROHodlerV1");
const GROVestingV1 = artifacts.require("GROVestingV1");
const {constants} = require("../utils/constants");
const {expect} = require("../utils/common-utils");

contract("GROVesting", function (accounts) {
    const INIT_MAX_TOTAL_SUPPLY = toBN(10_000_000).mul(constants.DEFAULT_FACTOR);
    const NON_INFLATION_PERIOD = toBN(3).mul(constants.ONE_YEAR_SECONDS);
    const INIT_UNLOCKED_PERCENT = toBN(1000);
    const TWO_WEEKS = 604800;

    const [deployer, groDeployer, dao, user1, user2, user3, vester1, vester2, vester3, burner, timeLock] = accounts;
    let gro, groDist, groVest, groBonus;

    function calcNewStartDate(amount, oldAmount, now, oldStart, maxPeriod) {
        let newTime = oldAmount.mul(oldStart).add(amount.mul(now)).div(amount.add(oldAmount));
        if (newTime.add(maxPeriod).cmp(now) < 0) {
            newTime = now - maxPeriod + TWO_WEEKS;
        }
        return newTime;
    }

    function calcNewVesting(startTime, now, total, maxPeriod) {
        // part1 = now.toNumber() - startTime.toNumber()
        // part2 = maxPeriod.toNumber();
        // const part3 = (now.toNumber() - startTime.toNumber()) / maxPeriod.toNumber();
        const _total = total.mul(constants.PERCENT_FACTOR.sub(INIT_UNLOCKED_PERCENT)).div(constants.PERCENT_FACTOR);
        // const part4 = _total.sub(_total.mul(toBN(Math.round(part3 * 10000))).div(constants.PERCENT_FACTOR));
        // console.log(`part3: ${part3}, _total: ${_total}, part4: ${part4}`);
        // console.log(`startTime: ${startTime}, now: ${now}, total: ${total}, maxPeriod: ${maxPeriod}, INIT_UNLOCKED_PERCENT: ${INIT_UNLOCKED_PERCENT}`);
        return _total.sub(_total.mul(toBN(now.toNumber() - startTime.toNumber())).div(toBN(maxPeriod.toNumber())));
    }

    function calcTotalVestingAmount(amounts, startTimes, now, maxPeriod, initUnlockedPercent = INIT_UNLOCKED_PERCENT) {
        let total = toBN(0);
        for (let i = 0; i < amounts.length; i++) {
            if (startTimes[i].add(maxPeriod).cmp(now) > 0) {
                const part = constants.PERCENT_FACTOR.sub(initUnlockedPercent)
                    .mul(startTimes[i].add(maxPeriod).sub(now))
                    .div(maxPeriod);
                total = total.add(
                    amounts[i]
                        .mul(constants.PERCENT_FACTOR.sub(initUnlockedPercent))
                        .mul(startTimes[i].add(maxPeriod).sub(now))
                        .div(maxPeriod)
                        .div(constants.PERCENT_FACTOR)
                );
            }
        }
        return total;
    }

    describe("feature", function () {
        beforeEach(async function () {
            gro = await GROToken.new("GRO", "GRO", INIT_MAX_TOTAL_SUPPLY, NON_INFLATION_PERIOD, {from: groDeployer});
            groVest = await GROVesting.new(constants.ZERO_ADDRESS, timeLock);
            let vesters = [vester1, vester2, vester3, groVest.address];
            groDist = await GRODistributer.new(gro.address, vesters, burner);
            await gro.setDistributer(groDist.address, {from: groDeployer});
            await groVest.setDistributer(groDist.address);
            groBonus = await MockBonus.new();

            await groVest.setVester(deployer, true);
            await groVest.setHodlerClaims(groBonus.address);
            await groVest.setStatus(false, {from: timeLock});
        });

        async function redeployVesting(period = 0) {
            const newGroVest = await GROVesting.new(groVest.address, timeLock);

            await newGroVest.setHodlerClaims(groBonus.address);
            await newGroVest.setVester(deployer, true);

            let vesters = [vester1, vester2, vester3, newGroVest.address];
            const newGroDist = await GRODistributer.new(gro.address, vesters, burner);
            await gro.setDistributer(newGroDist.address, {from: groDeployer});
            await newGroVest.setDistributer(newGroDist.address);

            if (period > 0) {
                await newGroVest.setMaxLockPeriod(period);
            }

            await newGroVest.setStatus(false, {from: timeLock});

            return newGroVest;
        }

        describe("Ownership", function () {
            it("setVester revert !Ownership", async () => {
                return expect(
                    groVest.setVester(constants.ZERO_ADDRESS, false, {from: dao})
                ).to.eventually.be.rejectedWith("caller is not the owner");
            });

            it("setMaxLockPeriod revert !Ownership", async () => {
                return expect(groVest.setMaxLockPeriod(1, {from: dao})).to.eventually.be.rejectedWith(
                    "caller is not the owner"
                );
            });

            it("setStatus revert !timeLock", async () => {
                return expect(groVest.setStatus(false)).to.eventually.be.rejectedWith("msg.sender != timelock");
            });

            it("Should not be possible to extend the maxPeriod factor above 200%", async () => {
                const origVestingPeriod = await groVest.maxLockPeriod();
                await groVest.setMaxLockPeriod(20000);
                expect(groVest.maxLockPeriod()).to.eventually.be.a.bignumber.equal(origVestingPeriod.mul(toBN(2)));
                return expect(groVest.setMaxLockPeriod(20001)).to.eventually.be.rejectedWith(
                    "adjustLockPeriod: newFactor > 20000"
                );
            });

            it("Should be possible to set a new bonus contract", async () => {
                await expect(groVest.hodlerClaims()).to.eventually.be.equal(groBonus.address);
                await groVest.setHodlerClaims(dao);
                return expect(groVest.hodlerClaims()).to.eventually.be.equal(dao);
            });
        });

        describe("vest", function () {
            it("revert !vester", async () => {
                return expect(groVest.vest(true, constants.ZERO_ADDRESS, 0, {from: dao})).to.eventually.be.rejectedWith(
                    "vest: !vester"
                );
            });

            it("revert !account", async () => {
                return expect(groVest.vest(true, constants.ZERO_ADDRESS, 0)).to.eventually.be.rejectedWith(
                    "vest: !account"
                );
            });

            it("revert !amount", async () => {
                return expect(groVest.vest(true, deployer, 0)).to.eventually.be.rejectedWith("vest: !amount");
            });

            it("Should no be possible to set a vesting period below 1 month", async () => {
                return expect(groVest.setMaxLockPeriod(0)).to.eventually.be.rejected;
            });

            it("ok with 100 unlock percent", async () => {
                const amount = toBN(10000).mul(constants.DEFAULT_FACTOR);
                await groVest.vest(true, user1, amount);
                maxPeriod = await groVest.maxLockPeriod();
                let b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(maxPeriod).toNumber()],
                });
                await network.provider.send("evm_mine");
                await expect(groVest.totalBalance(user1)).to.eventually.be.a.bignumber.equal(amount);
                await expect(groVest.vestedBalance(user1)).to.eventually.be.a.bignumber.equal(amount);
                return expect(groVest.vestingBalance(user1)).to.eventually.be.a.bignumber.equal(toBN(0));
            });

            it("ok with normal lock period and initial unlock percent", async () => {
                const period = toBN(1000);
                const modified_vesting = constants.ONE_YEAR_SECONDS.mul(period).div(toBN(10000));
                await groVest.setMaxLockPeriod(period);

                const amount = toBN(10000).mul(constants.DEFAULT_FACTOR);
                const pct = await groVest.initUnlockedPercent();
                const initAmount = amount.mul(pct).div(constants.PERCENT_FACTOR);

                await groVest.vest(true, deployer, amount);
                // initial validation
                await expect(groVest.totalBalance(deployer)).to.eventually.be.a.bignumber.equal(amount);
                await expect(groVest.vestedBalance(deployer)).to.eventually.be.a.bignumber.equal(initAmount);
                await expect(groVest.vestingBalance(deployer)).to.eventually.be.a.bignumber.equal(
                    amount.sub(initAmount)
                );

                let b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [
                        toBN(b.timestamp)
                            .add(modified_vesting.sub(modified_vesting.div(toBN(4))))
                            .toNumber(),
                    ],
                });
                await groVest.setMaxLockPeriod(period);

                // middle validation after 3/4 period past
                await expect(groVest.totalBalance(deployer)).to.eventually.be.a.bignumber.equal(amount);
                await expect(groVest.vestedBalance(deployer)).to.eventually.be.a.bignumber.closeTo(
                    amount.sub(amount.sub(initAmount).div(toBN(4))),
                    toBN(1e18)
                );
                await expect(groVest.vestingBalance(deployer)).to.eventually.be.a.bignumber.closeTo(
                    amount.sub(initAmount).div(toBN(4)),
                    toBN(1e18)
                );

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(modified_vesting).toNumber()],
                });
                await groVest.setMaxLockPeriod(period);

                // final validation after all period past
                await expect(groVest.totalBalance(deployer)).to.eventually.be.a.bignumber.equal(amount);
                await expect(groVest.vestedBalance(deployer)).to.eventually.be.a.bignumber.equal(amount);
                await expect(groVest.vestingBalance(deployer)).to.eventually.be.a.bignumber.equal(toBN(0));
                return;
            });

            it("multi vestings", async () => {
                const period = toBN(1000);
                const modified_vesting = constants.ONE_YEAR_SECONDS.mul(period).div(toBN(10000));
                await groVest.setMaxLockPeriod(period);

                // 1st vesting
                const amount = toBN(10000).mul(constants.DEFAULT_FACTOR);
                const pct = await groVest.initUnlockedPercent();

                await groVest.vest(true, deployer, amount);
                let total = amount;
                let initAmount = total.mul(pct).div(constants.PERCENT_FACTOR);
                await expect(groVest.totalBalance(deployer)).to.eventually.be.a.bignumber.equal(total);
                await expect(groVest.vestedBalance(deployer)).to.eventually.be.a.bignumber.equal(initAmount);
                await expect(groVest.vestingBalance(deployer)).to.eventually.be.a.bignumber.equal(
                    total.sub(initAmount)
                );
                maxPeriod = await groVest.maxLockPeriod();

                // 2nd vesting
                let b = await web3.eth.getBlock("latest");
                let setTime = toBN(b.timestamp).add(modified_vesting.div(toBN(4)));
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [setTime.toNumber()],
                });

                let ai = await groVest.accountInfos(deployer);
                let newStartTime = await calcNewStartDate(amount, ai.total, toBN(setTime), ai.startTime, maxPeriod);
                await groVest.vest(true, deployer, amount);
                ai = await groVest.accountInfos(deployer);
                total = total.add(amount);
                assert.approximately(newStartTime.toNumber(), ai.startTime.toNumber(), 1, "startdates are close");
                assert.strictEqual(total.toString(), ai.total.toString());
                vesting = calcNewVesting(ai.startTime, setTime, total, maxPeriod);
                await expect(groVest.totalBalance(deployer)).to.eventually.be.a.bignumber.equal(total);
                await expect(groVest.vestedBalance(deployer)).to.eventually.be.a.bignumber.closeTo(
                    total.sub(vesting),
                    toBN(1e18)
                );
                await expect(groVest.vestingBalance(deployer)).to.eventually.be.a.bignumber.closeTo(
                    vesting,
                    toBN(1e18)
                );

                // 3rd vesting
                b = await web3.eth.getBlock("latest");
                setTime = toBN(b.timestamp).add(modified_vesting.div(toBN(2)));
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [setTime.toNumber()],
                });

                ai = await groVest.accountInfos(deployer);
                newStartTime = await calcNewStartDate(amount, ai.total, toBN(setTime), ai.startTime, maxPeriod);
                await groVest.vest(true, deployer, amount);
                ai = await groVest.accountInfos(deployer);
                total = total.add(amount);
                assert.approximately(newStartTime.toNumber(), ai.startTime.toNumber(), 1, "startdates are close");
                assert.strictEqual(total.toString(), ai.total.toString());
                vesting = calcNewVesting(ai.startTime, setTime, total, maxPeriod);
                await expect(groVest.totalBalance(deployer)).to.eventually.be.a.bignumber.equal(total);
                await expect(groVest.vestedBalance(deployer)).to.eventually.be.a.bignumber.closeTo(
                    total.sub(vesting),
                    toBN(1e18)
                );
                await expect(groVest.vestingBalance(deployer)).to.eventually.be.a.bignumber.closeTo(
                    vesting,
                    toBN(1e18)
                );

                // 4th vesting
                b = await web3.eth.getBlock("latest");
                setTime = toBN(b.timestamp).add(modified_vesting);
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [setTime.toNumber()],
                });

                ai = await groVest.accountInfos(deployer);
                newStartTime = await calcNewStartDate(amount, ai.total, toBN(setTime), ai.startTime, maxPeriod);
                await groVest.vest(true, deployer, amount);
                ai = await groVest.accountInfos(deployer);
                total = total.add(amount);
                assert.approximately(newStartTime, ai.startTime.toNumber(), 1, "startdates are close");
                assert.strictEqual(total.toString(), ai.total.toString());
                vesting = calcNewVesting(ai.startTime, setTime, total, maxPeriod);
                await expect(groVest.totalBalance(deployer)).to.eventually.be.a.bignumber.equal(total);
                await expect(groVest.vestedBalance(deployer)).to.eventually.be.a.bignumber.closeTo(
                    total.sub(vesting),
                    toBN(1)
                );
                await expect(groVest.vestingBalance(deployer)).to.eventually.be.a.bignumber.closeTo(vesting, toBN(1));
                return;
            });

            it("Should return the correct start and end date for the user", async () => {
                const period = toBN(1000);
                const modified_vesting = constants.ONE_YEAR_SECONDS.mul(period).div(toBN(10000));
                await groVest.setMaxLockPeriod(period);
                const amount = toBN(10000).mul(constants.DEFAULT_FACTOR);
                const pct = await groVest.initUnlockedPercent();
                const initAmount = amount.mul(pct).div(constants.PERCENT_FACTOR);

                b = await web3.eth.getBlock("latest");
                await groVest.vest(true, deployer, amount);
                const vestingDates = await groVest.getVestingDates(deployer);
                const ts = toBN(b.timestamp);
                const maxLock = await groVest.maxLockPeriod();
                assert.strictEqual(vestingDates[0].toString(), ts.add(toBN(1)).toString());
                assert.strictEqual(vestingDates[1].toString(), ts.add(toBN(1)).add(maxLock).toString());
            });

            it("instant vesting", async () => {
                const amount = toBN(10000).mul(constants.DEFAULT_FACTOR);
                const pct = await groVest.instantUnlockPercent();
                const instantAmount = amount.mul(pct).div(constants.PERCENT_FACTOR);

                await groVest.vest(false, deployer, amount);

                let ai = await groVest.accountInfos(user3);
                expect(ai.startTime).to.be.a.bignumber.equal(toBN(0));
                await expect(groVest.totalBalance(deployer)).to.eventually.be.a.bignumber.equal(toBN(0));
                await expect(gro.balanceOf(deployer)).to.eventually.be.a.bignumber.equal(instantAmount);

                await groVest.vest(true, deployer, amount);

                const vesting = await groVest.totalBalance(deployer);
                await groVest.vest(false, deployer, amount);
                await expect(groVest.totalBalance(deployer)).to.eventually.be.a.bignumber.equal(vesting);
                await expect(gro.balanceOf(deployer)).to.eventually.be.a.bignumber.equal(instantAmount.mul(toBN(2)));

                return;
            });

            it("multi vestings with migration", async () => {
                const period = toBN(1000);
                const modified_vesting = constants.ONE_YEAR_SECONDS.mul(period).div(toBN(10000));
                await groVest.setMaxLockPeriod(period);

                // 1st vesting
                const amount = toBN(10000).mul(constants.DEFAULT_FACTOR);
                const pct = await groVest.initUnlockedPercent();

                await groVest.vest(true, deployer, amount);
                let total = amount;
                let initAmount = total.mul(pct).div(constants.PERCENT_FACTOR);
                await expect(groVest.totalBalance(deployer)).to.eventually.be.a.bignumber.equal(total);
                await expect(groVest.vestedBalance(deployer)).to.eventually.be.a.bignumber.equal(initAmount);
                await expect(groVest.vestingBalance(deployer)).to.eventually.be.a.bignumber.equal(
                    total.sub(initAmount)
                );
                maxPeriod = await groVest.maxLockPeriod();

                // 2nd vesting
                let b = await web3.eth.getBlock("latest");
                let setTime = toBN(b.timestamp).add(modified_vesting.div(toBN(4)));
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [setTime.toNumber()],
                });

                let ai = await groVest.accountInfos(deployer);
                let newStartTime = await calcNewStartDate(amount, ai.total, toBN(setTime), ai.startTime, maxPeriod);
                await groVest.vest(true, deployer, amount);
                ai = await groVest.accountInfos(deployer);
                total = total.add(amount);
                assert.approximately(newStartTime.toNumber(), ai.startTime.toNumber(), 1, "startdates are close");
                assert.strictEqual(total.toString(), ai.total.toString());
                vesting = calcNewVesting(ai.startTime, setTime, total, maxPeriod);
                await expect(groVest.totalBalance(deployer)).to.eventually.be.a.bignumber.equal(total);
                await expect(groVest.vestedBalance(deployer)).to.eventually.be.a.bignumber.closeTo(
                    total.sub(vesting),
                    toBN(1e18)
                );
                await expect(groVest.vestingBalance(deployer)).to.eventually.be.a.bignumber.closeTo(
                    vesting,
                    toBN(1e18)
                );

                const newGroVest = await redeployVesting(period);

                // 3rd vesting
                b = await web3.eth.getBlock("latest");
                setTime = toBN(b.timestamp).add(modified_vesting.div(toBN(2)));
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [setTime.toNumber()],
                });

                ai = await groVest.accountInfos(deployer);
                newStartTime = await calcNewStartDate(amount, ai.total, toBN(setTime), ai.startTime, maxPeriod);
                await newGroVest.vest(true, deployer, amount);
                ai = await newGroVest.accountInfos(deployer);
                total = total.add(amount);
                assert.approximately(newStartTime.toNumber(), ai.startTime.toNumber(), 1, "startdates are close");
                assert.strictEqual(total.toString(), ai.total.toString());
                vesting = calcNewVesting(ai.startTime, setTime, total, maxPeriod);
                await expect(newGroVest.totalBalance(deployer)).to.eventually.be.a.bignumber.equal(total);
                await expect(newGroVest.vestedBalance(deployer)).to.eventually.be.a.bignumber.closeTo(
                    total.sub(vesting),
                    toBN(1e18)
                );
                await expect(newGroVest.vestingBalance(deployer)).to.eventually.be.a.bignumber.closeTo(
                    vesting,
                    toBN(1e18)
                );

                // 4th vesting
                b = await web3.eth.getBlock("latest");
                setTime = toBN(b.timestamp).add(modified_vesting);
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [setTime.toNumber()],
                });

                ai = await newGroVest.accountInfos(deployer);
                newStartTime = await calcNewStartDate(amount, ai.total, toBN(setTime), ai.startTime, maxPeriod);
                await newGroVest.vest(true, deployer, amount);
                ai = await newGroVest.accountInfos(deployer);
                total = total.add(amount);
                assert.approximately(newStartTime, ai.startTime.toNumber(), 1, "startdates are close");
                assert.strictEqual(total.toString(), ai.total.toString());
                vesting = calcNewVesting(ai.startTime, setTime, total, maxPeriod);
                await expect(newGroVest.totalBalance(deployer)).to.eventually.be.a.bignumber.equal(total);
                await expect(newGroVest.vestedBalance(deployer)).to.eventually.be.a.bignumber.closeTo(
                    total.sub(vesting),
                    toBN(1)
                );
                await expect(newGroVest.vestingBalance(deployer)).to.eventually.be.a.bignumber.closeTo(
                    vesting,
                    toBN(1)
                );

                return;
            });
        });

        describe("extend", function () {
            it("revert !duration", async () => {
                return expect(groVest.extend(NON_INFLATION_PERIOD)).to.eventually.be.rejectedWith(
                    "extend: extension > 100%"
                );
            });

            it("revert no vesting", async () => {
                return expect(groVest.extend(1000)).to.eventually.be.rejectedWith("extend: no vesting");
            });

            it("ok", async () => {
                const period = toBN(1000);
                const modified_vesting = constants.ONE_YEAR_SECONDS.mul(period).div(toBN(10000));
                await groVest.setMaxLockPeriod(period);
                const amount = toBN(10000).mul(constants.DEFAULT_FACTOR);
                const pct = await groVest.initUnlockedPercent();
                const initAmount = amount.mul(pct).div(constants.PERCENT_FACTOR);

                await groVest.vest(true, deployer, amount);

                let b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [
                        toBN(b.timestamp)
                            .add(modified_vesting.sub(modified_vesting.div(toBN(4))))
                            .toNumber(),
                    ],
                });
                await groVest.extend(2500);
                await expect(groVest.totalBalance(deployer)).to.eventually.be.a.bignumber.equal(amount);
                await expect(groVest.vestedBalance(deployer)).to.eventually.be.a.bignumber.closeTo(
                    amount.sub(amount.sub(initAmount).div(toBN(2))),
                    toBN(1e18)
                );
                await expect(groVest.vestingBalance(deployer)).to.eventually.be.a.bignumber.closeTo(
                    amount.sub(initAmount).div(toBN(2)),
                    toBN(1e18)
                );

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(modified_vesting).toNumber()],
                });
                await network.provider.send("evm_mine");
                await expect(groVest.totalBalance(deployer)).to.eventually.be.a.bignumber.equal(amount);
                await expect(groVest.vestedBalance(deployer)).to.eventually.be.a.bignumber.equal(amount);
                await expect(groVest.vestingBalance(deployer)).to.eventually.be.a.bignumber.equal(toBN(0));

                await groVest.extend(10000);
                await expect(groVest.totalBalance(deployer)).to.eventually.be.a.bignumber.equal(amount);
                await expect(groVest.vestedBalance(deployer)).to.eventually.be.a.bignumber.equal(initAmount);
                await expect(groVest.vestingBalance(deployer)).to.eventually.be.a.bignumber.equal(
                    amount.sub(initAmount)
                );

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(modified_vesting).toNumber()],
                });
                await groVest.setMaxLockPeriod(period);
                await expect(groVest.totalBalance(deployer)).to.eventually.be.a.bignumber.equal(amount);
                await expect(groVest.vestedBalance(deployer)).to.eventually.be.a.bignumber.equal(amount);
                await expect(groVest.vestingBalance(deployer)).to.eventually.be.a.bignumber.equal(toBN(0));

                return;
            });

            it("Should not be possible to extend pass the max vesting period", async () => {
                const period = toBN(1000);
                const modified_vesting = constants.ONE_YEAR_SECONDS.mul(period).div(toBN(10000));
                await groVest.setMaxLockPeriod(period);
                const amount = toBN(10000).mul(constants.DEFAULT_FACTOR);
                const pct = await groVest.initUnlockedPercent();
                const initAmount = amount.mul(pct).div(constants.PERCENT_FACTOR);

                await groVest.vest(true, deployer, amount);
                await groVest.vest(true, dao, amount);

                const b = await web3.eth.getBlock("latest");
                const newTimeStamp = toBN(b.timestamp).add(modified_vesting.sub(modified_vesting.div(toBN(2))));
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [newTimeStamp.toNumber()],
                });

                await network.provider.send("evm_mine");
                const depVestPre = await groVest.vestingBalance(deployer);
                await groVest.extend(10000);
                const startDate = (await groVest.accountInfos(deployer)).startTime;
                // should be new time (+1 for mining operation)
                assert.strictEqual(startDate.toString(), newTimeStamp.add(toBN(1)).toString());
                const depVest = await groVest.vestingBalance(deployer);
                // should be back to the full vest
                expect(groVest.vestingBalance(deployer)).to.eventually.be.a.bignumber.gt(depVestPre);
                await groVest.extend(6000, {from: dao});
                // both vests should be the same
                return expect(groVest.vestingBalance(dao)).to.eventually.be.a.bignumber.equal(depVest);
            });

            it("ok with migration", async () => {
                const period = toBN(1000);
                const modified_vesting = constants.ONE_YEAR_SECONDS.mul(period).div(toBN(10000));
                await groVest.setMaxLockPeriod(period);
                const amount = toBN(10000).mul(constants.DEFAULT_FACTOR);
                const pct = await groVest.initUnlockedPercent();
                const initAmount = amount.mul(pct).div(constants.PERCENT_FACTOR);

                await groVest.vest(true, deployer, amount);

                let b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [
                        toBN(b.timestamp)
                            .add(modified_vesting.sub(modified_vesting.div(toBN(4))))
                            .toNumber(),
                    ],
                });
                await groVest.extend(2500);
                await expect(groVest.totalBalance(deployer)).to.eventually.be.a.bignumber.equal(amount);
                await expect(groVest.vestedBalance(deployer)).to.eventually.be.a.bignumber.closeTo(
                    amount.sub(amount.sub(initAmount).div(toBN(2))),
                    toBN(1e18)
                );
                await expect(groVest.vestingBalance(deployer)).to.eventually.be.a.bignumber.closeTo(
                    amount.sub(initAmount).div(toBN(2)),
                    toBN(1e18)
                );

                const newGroVest = await redeployVesting(period);

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(modified_vesting).toNumber()],
                });
                await network.provider.send("evm_mine");
                await expect(newGroVest.totalBalance(deployer)).to.eventually.be.a.bignumber.equal(amount);
                await expect(newGroVest.vestedBalance(deployer)).to.eventually.be.a.bignumber.equal(amount);
                await expect(newGroVest.vestingBalance(deployer)).to.eventually.be.a.bignumber.equal(toBN(0));

                await newGroVest.extend(10000);
                await expect(newGroVest.totalBalance(deployer)).to.eventually.be.a.bignumber.equal(amount);
                await expect(newGroVest.vestedBalance(deployer)).to.eventually.be.a.bignumber.equal(initAmount);
                await expect(newGroVest.vestingBalance(deployer)).to.eventually.be.a.bignumber.equal(
                    amount.sub(initAmount)
                );

                const ai = await newGroVest.accountInfos(deployer);
                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [
                        toBN(b.timestamp)
                            .add(modified_vesting.div(toBN(3)))
                            .toNumber(),
                    ],
                });
                await newGroVest.setMaxLockPeriod(period);
                b = await web3.eth.getBlock("latest");
                const vesting = calcNewVesting(ai.startTime, toBN(b.timestamp), ai.total, modified_vesting);
                await expect(newGroVest.totalBalance(deployer)).to.eventually.be.a.bignumber.equal(amount);
                await expect(newGroVest.vestingBalance(deployer)).to.eventually.be.a.bignumber.equal(vesting);
                await expect(newGroVest.vestedBalance(deployer)).to.eventually.be.a.bignumber.equal(
                    amount.sub(vesting)
                );

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(modified_vesting).toNumber()],
                });
                await newGroVest.setMaxLockPeriod(period);
                await expect(newGroVest.totalBalance(deployer)).to.eventually.be.a.bignumber.equal(amount);
                await expect(newGroVest.vestedBalance(deployer)).to.eventually.be.a.bignumber.equal(amount);
                await expect(newGroVest.vestingBalance(deployer)).to.eventually.be.a.bignumber.equal(toBN(0));

                return;
            });
        });

        describe("exit", function () {
            it("revert !amount", async () => {
                return expect(groVest.exit(0)).to.eventually.be.rejectedWith("exit: !amount");
            });

            it("revert no vesting", async () => {
                return expect(groVest.exit(1)).to.eventually.be.rejectedWith("exit: no vesting");
            });

            it("Should revert when getting the dates if there is no active position", async () => {
                return expect(groVest.getVestingDates(user1)).to.eventually.be.rejectedWith(
                    "getVestingDates: No active position"
                );
            });

            it("ok during vesting period", async () => {
                const period = toBN(1000);
                const modified_vesting = constants.ONE_YEAR_SECONDS.mul(period).div(toBN(10000));
                await groVest.setMaxLockPeriod(period);
                const amount = toBN(10000).mul(constants.DEFAULT_FACTOR);
                const pct = await groVest.initUnlockedPercent();
                const initAmount = amount.mul(pct).div(constants.PERCENT_FACTOR);

                await groVest.vest(true, groDeployer, amount);
                await groVest.vest(true, deployer, amount);
                await expect(groVest.totalLockedAmount()).to.eventually.be.a.bignumber.equal(amount.mul(toBN(2)));

                const b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [
                        toBN(b.timestamp)
                            .add(modified_vesting.div(toBN(10)))
                            .toNumber(),
                    ],
                });
                let eAmount = amount.div(toBN(4));
                let lAmount = amount.sub(eAmount);
                await groVest.exit(eAmount);

                let unlocked = initAmount.add(amount.sub(initAmount).div(toBN(10)));
                let eUnlocked = unlocked.div(toBN(4));
                let lUnlocked = unlocked.sub(eUnlocked);
                await expect(groVest.totalBalance(deployer)).to.eventually.be.a.bignumber.equal(lAmount);
                await expect(groVest.vestedBalance(deployer)).to.eventually.be.a.bignumber.closeTo(
                    lUnlocked,
                    toBN(1e16)
                );
                await expect(groVest.vestingBalance(deployer)).to.eventually.be.a.bignumber.closeTo(
                    lAmount.sub(lUnlocked),
                    toBN(1e16)
                );
                await expect(groVest.totalWithdrawn(deployer)).to.eventually.be.a.bignumber.closeTo(
                    eUnlocked,
                    toBN(1e16)
                );
                await expect(gro.balanceOf(deployer)).to.eventually.be.a.bignumber.closeTo(eUnlocked, toBN(1e16));
                await expect(groVest.totalBalance(groDeployer)).to.eventually.be.a.bignumber.equal(amount);
                await expect(groVest.totalLockedAmount()).to.eventually.be.a.bignumber.equal(amount.add(lAmount));

                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [
                        toBN(b.timestamp)
                            .add(modified_vesting.div(toBN(4)))
                            .toNumber(),
                    ],
                });
                let tw = await groVest.totalWithdrawn(deployer);
                let bo = await gro.balanceOf(deployer);
                await groVest.exit(INIT_MAX_TOTAL_SUPPLY);

                unlocked = initAmount.add(amount.sub(initAmount).div(toBN(4)));
                unlocked = unlocked.mul(toBN(3)).div(toBN(4));
                await expect(groVest.totalBalance(deployer)).to.eventually.be.a.bignumber.equal(toBN(0));
                await expect(groVest.vestedBalance(deployer)).to.eventually.be.a.bignumber.equal(toBN(0));
                await expect(groVest.vestingBalance(deployer)).to.eventually.be.a.bignumber.equal(toBN(0));
                await expect(groVest.totalWithdrawn(deployer)).to.eventually.be.a.bignumber.closeTo(
                    tw.add(unlocked),
                    toBN(1e16)
                );
                await expect(gro.balanceOf(deployer)).to.eventually.be.a.bignumber.closeTo(
                    bo.add(unlocked),
                    toBN(1e16)
                );
                await expect(groVest.totalBalance(groDeployer)).to.eventually.be.a.bignumber.equal(amount);
                await expect(groVest.totalLockedAmount()).to.eventually.be.a.bignumber.equal(amount);

                return;
            });

            it("ok after vesting period", async () => {
                const period = toBN(1000);
                const modified_vesting = constants.ONE_YEAR_SECONDS.mul(period).div(toBN(10000));
                await groVest.setMaxLockPeriod(period);
                const amount = toBN(10000).mul(constants.DEFAULT_FACTOR);
                const pct = await groVest.initUnlockedPercent();
                const initAmount = amount.mul(pct).div(constants.PERCENT_FACTOR);

                await groVest.vest(true, deployer, amount);

                let b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [
                        toBN(b.timestamp)
                            .add(modified_vesting.div(toBN(2)))
                            .toNumber(),
                    ],
                });
                await groVest.vest(true, groDeployer, amount);
                await expect(groVest.totalLockedAmount()).to.eventually.be.a.bignumber.equal(amount.mul(toBN(2)));

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [
                        toBN(b.timestamp)
                            .add(modified_vesting.div(toBN(2)))
                            .toNumber(),
                    ],
                });
                let eAmount = amount.div(toBN(4));
                let lAmount = amount.sub(eAmount);
                await groVest.exit(eAmount);

                await expect(groVest.totalBalance(deployer)).to.eventually.be.a.bignumber.equal(lAmount);
                await expect(groVest.vestedBalance(deployer)).to.eventually.be.a.bignumber.closeTo(lAmount, toBN(1e16));
                await expect(groVest.vestingBalance(deployer)).to.eventually.be.a.bignumber.closeTo(
                    toBN(0),
                    toBN(1e16)
                );
                await expect(groVest.totalWithdrawn(deployer)).to.eventually.be.a.bignumber.closeTo(
                    eAmount,
                    toBN(1e16)
                );
                await expect(gro.balanceOf(deployer)).to.eventually.be.a.bignumber.closeTo(eAmount, toBN(1e16));
                await expect(groVest.totalBalance(groDeployer)).to.eventually.be.a.bignumber.equal(amount);
                await expect(groVest.totalLockedAmount()).to.eventually.be.a.bignumber.equal(amount.add(lAmount));
                //NOTE check
                await expect(groVest.vestedBalance(groDeployer)).to.eventually.be.a.bignumber.closeTo(
                    amount.sub(amount.sub(initAmount).div(toBN(2))),
                    toBN(1e18)
                );
                await expect(groVest.vestingBalance(groDeployer)).to.eventually.be.a.bignumber.closeTo(
                    amount.sub(initAmount).div(toBN(2)),
                    toBN(1e18)
                );

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [
                        toBN(b.timestamp)
                            .add(modified_vesting.div(toBN(10)))
                            .toNumber(),
                    ],
                });
                let tw = await groVest.totalWithdrawn(deployer);
                let bo = await gro.balanceOf(deployer);
                await groVest.exit(INIT_MAX_TOTAL_SUPPLY);

                await expect(groVest.totalBalance(deployer)).to.eventually.be.a.bignumber.equal(toBN(0));
                await expect(groVest.vestedBalance(deployer)).to.eventually.be.a.bignumber.equal(toBN(0));
                await expect(groVest.vestingBalance(deployer)).to.eventually.be.a.bignumber.equal(toBN(0));
                await expect(groVest.totalWithdrawn(deployer)).to.eventually.be.a.bignumber.closeTo(
                    tw.add(lAmount),
                    toBN(1e16)
                );
                await expect(gro.balanceOf(deployer)).to.eventually.be.a.bignumber.closeTo(bo.add(lAmount), toBN(1e16));
                await expect(groVest.totalBalance(groDeployer)).to.eventually.be.a.bignumber.equal(amount);
                await expect(groVest.totalLockedAmount()).to.eventually.be.a.bignumber.equal(amount);

                const ai = await groVest.accountInfos(deployer);
                expect(ai.startTime).be.a.bignumber.equal(toBN(0));

                return;
            });

            it("ok during vesting period with migration", async () => {
                const period = toBN(1000);
                const modified_vesting = constants.ONE_YEAR_SECONDS.mul(period).div(toBN(10000));
                await groVest.setMaxLockPeriod(period);
                const amount = toBN(10000).mul(constants.DEFAULT_FACTOR);
                const pct = await groVest.initUnlockedPercent();
                const initAmount = amount.mul(pct).div(constants.PERCENT_FACTOR);

                await groVest.vest(true, groDeployer, amount);
                await groVest.vest(true, deployer, amount);
                await expect(groVest.totalLockedAmount()).to.eventually.be.a.bignumber.equal(amount.mul(toBN(2)));

                const b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [
                        toBN(b.timestamp)
                            .add(modified_vesting.div(toBN(10)))
                            .toNumber(),
                    ],
                });
                let eAmount = amount.div(toBN(4));
                let lAmount = amount.sub(eAmount);
                await groVest.exit(eAmount);

                let unlocked = initAmount.add(amount.sub(initAmount).div(toBN(10)));
                let eUnlocked = unlocked.div(toBN(4));
                let lUnlocked = unlocked.sub(eUnlocked);
                await expect(groVest.totalBalance(deployer)).to.eventually.be.a.bignumber.equal(lAmount);
                await expect(groVest.vestedBalance(deployer)).to.eventually.be.a.bignumber.closeTo(
                    lUnlocked,
                    toBN(1e16)
                );
                await expect(groVest.vestingBalance(deployer)).to.eventually.be.a.bignumber.closeTo(
                    lAmount.sub(lUnlocked),
                    toBN(1e16)
                );
                await expect(groVest.totalWithdrawn(deployer)).to.eventually.be.a.bignumber.closeTo(
                    eUnlocked,
                    toBN(1e16)
                );
                await expect(gro.balanceOf(deployer)).to.eventually.be.a.bignumber.closeTo(eUnlocked, toBN(1e16));
                await expect(groVest.totalBalance(groDeployer)).to.eventually.be.a.bignumber.equal(amount);
                await expect(groVest.totalLockedAmount()).to.eventually.be.a.bignumber.equal(amount.add(lAmount));

                const newGroVest = await redeployVesting(period);

                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [
                        toBN(b.timestamp)
                            .add(modified_vesting.div(toBN(4)))
                            .toNumber(),
                    ],
                });
                let tw = await newGroVest.totalWithdrawn(deployer);
                let bo = await gro.balanceOf(deployer);
                await newGroVest.exit(INIT_MAX_TOTAL_SUPPLY);

                unlocked = initAmount.add(amount.sub(initAmount).div(toBN(4)));
                unlocked = unlocked.mul(toBN(3)).div(toBN(4));
                await expect(newGroVest.totalBalance(deployer)).to.eventually.be.a.bignumber.equal(toBN(0));
                await expect(newGroVest.vestedBalance(deployer)).to.eventually.be.a.bignumber.equal(toBN(0));
                await expect(newGroVest.vestingBalance(deployer)).to.eventually.be.a.bignumber.equal(toBN(0));
                await expect(newGroVest.totalWithdrawn(deployer)).to.eventually.be.a.bignumber.closeTo(
                    tw.add(unlocked),
                    toBN(1e16)
                );
                await expect(gro.balanceOf(deployer)).to.eventually.be.a.bignumber.closeTo(
                    bo.add(unlocked),
                    toBN(1e16)
                );
                await expect(newGroVest.totalBalance(groDeployer)).to.eventually.be.a.bignumber.equal(amount);
                await expect(newGroVest.totalLockedAmount()).to.eventually.be.a.bignumber.equal(amount);

                return;
            });

            it("ok after vesting period with migration", async () => {
                const period = toBN(1000);
                const modified_vesting = constants.ONE_YEAR_SECONDS.mul(period).div(toBN(10000));
                await groVest.setMaxLockPeriod(period);
                const amount = toBN(10000).mul(constants.DEFAULT_FACTOR);
                const pct = await groVest.initUnlockedPercent();
                const initAmount = amount.mul(pct).div(constants.PERCENT_FACTOR);

                await groVest.vest(true, deployer, amount);

                let b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [
                        toBN(b.timestamp)
                            .add(modified_vesting.div(toBN(2)))
                            .toNumber(),
                    ],
                });
                await groVest.vest(true, groDeployer, amount);
                await expect(groVest.totalLockedAmount()).to.eventually.be.a.bignumber.equal(amount.mul(toBN(2)));

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [
                        toBN(b.timestamp)
                            .add(modified_vesting.div(toBN(2)))
                            .toNumber(),
                    ],
                });
                let eAmount = amount.div(toBN(4));
                let lAmount = amount.sub(eAmount);
                await groVest.exit(eAmount);

                await expect(groVest.totalBalance(deployer)).to.eventually.be.a.bignumber.equal(lAmount);
                await expect(groVest.vestedBalance(deployer)).to.eventually.be.a.bignumber.closeTo(lAmount, toBN(1e16));
                await expect(groVest.vestingBalance(deployer)).to.eventually.be.a.bignumber.closeTo(
                    toBN(0),
                    toBN(1e16)
                );
                await expect(groVest.totalWithdrawn(deployer)).to.eventually.be.a.bignumber.closeTo(
                    eAmount,
                    toBN(1e16)
                );
                await expect(gro.balanceOf(deployer)).to.eventually.be.a.bignumber.closeTo(eAmount, toBN(1e16));
                await expect(groVest.totalBalance(groDeployer)).to.eventually.be.a.bignumber.equal(amount);
                await expect(groVest.totalLockedAmount()).to.eventually.be.a.bignumber.equal(amount.add(lAmount));
                //NOTE check
                await expect(groVest.vestedBalance(groDeployer)).to.eventually.be.a.bignumber.closeTo(
                    amount.sub(amount.sub(initAmount).div(toBN(2))),
                    toBN(1e18)
                );
                await expect(groVest.vestingBalance(groDeployer)).to.eventually.be.a.bignumber.closeTo(
                    amount.sub(initAmount).div(toBN(2)),
                    toBN(1e18)
                );

                const newGroVest = await redeployVesting(period);

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [
                        toBN(b.timestamp)
                            .add(modified_vesting.div(toBN(10)))
                            .toNumber(),
                    ],
                });
                let tw = await newGroVest.totalWithdrawn(deployer);
                let bo = await gro.balanceOf(deployer);
                await newGroVest.exit(INIT_MAX_TOTAL_SUPPLY);

                await expect(newGroVest.totalBalance(deployer)).to.eventually.be.a.bignumber.equal(toBN(0));
                await expect(newGroVest.vestedBalance(deployer)).to.eventually.be.a.bignumber.equal(toBN(0));
                await expect(newGroVest.vestingBalance(deployer)).to.eventually.be.a.bignumber.equal(toBN(0));
                await expect(newGroVest.totalWithdrawn(deployer)).to.eventually.be.a.bignumber.closeTo(
                    tw.add(lAmount),
                    toBN(1e16)
                );
                await expect(gro.balanceOf(deployer)).to.eventually.be.a.bignumber.closeTo(bo.add(lAmount), toBN(1e16));
                await expect(newGroVest.totalBalance(groDeployer)).to.eventually.be.a.bignumber.equal(amount);
                await expect(newGroVest.totalLockedAmount()).to.eventually.be.a.bignumber.equal(amount);

                const ai = await newGroVest.accountInfos(deployer);
                expect(ai.startTime).be.a.bignumber.equal(toBN(0));
                expect(ai.total).be.a.bignumber.equal(toBN(0));

                return;
            });
        });

        describe("calculate Groove", function () {
            let maxPeriod;

            beforeEach(async function () {
                maxPeriod = await groVest.maxLockPeriod();
            });

            it("Should return 0 groove if current timestamp > global start time + maxVestPeriod", async () => {
                await groVest.vest(true, user1, toBN(1000).mul(constants.DEFAULT_FACTOR));
                let ai = await groVest.accountInfos(user1);
                await expect(groVest.totalGroove()).to.eventually.be.a.bignumber.gt(toBN(0));
                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [
                        toBN(b.timestamp)
                            .add(await groVest.maxLockPeriod())
                            .toNumber(),
                    ],
                });
                await network.provider.send("evm_mine");
                return expect(groVest.totalGroove()).to.eventually.be.a.bignumber.equal(toBN(0));
            });

            it("add", async () => {
                const uas = [
                    toBN(1000).mul(constants.DEFAULT_FACTOR),
                    toBN(2000).mul(constants.DEFAULT_FACTOR),
                    toBN(3000).mul(constants.DEFAULT_FACTOR),
                ];
                const uss = [];

                await groVest.vest(false, user2, uas[0]);

                await groVest.vest(true, user1, uas[0]);
                let ai = await groVest.accountInfos(user1);
                uss.push(toBN(ai.startTime));

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(toBN(10000)).toNumber()],
                });
                await groVest.vest(true, user2, uas[1]);
                ai = await groVest.accountInfos(user2);
                uss.push(toBN(ai.startTime));

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(toBN(10000)).toNumber()],
                });
                await groVest.vest(false, user3, uas[0]);

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(toBN(12000)).toNumber()],
                });
                await groVest.vest(true, user3, uas[2]);
                ai = await groVest.accountInfos(user3);
                uss.push(toBN(ai.startTime));

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(toBN(12000)).toNumber()],
                });
                await groVest.vest(false, user1, uas[1]);

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(toBN(3000)).toNumber()],
                });
                await groVest.setVester(deployer, true);

                b = await web3.eth.getBlock("latest");
                const totalVestingAmount = calcTotalVestingAmount(uas, uss, toBN(b.timestamp), maxPeriod);
                await expect(groVest.totalGroove()).to.eventually.be.a.bignumber.closeTo(
                    totalVestingAmount,
                    constants.DEFAULT_FACTOR
                );

                return;
            });

            it("exit", async () => {
                let ua1 = toBN(1000).mul(constants.DEFAULT_FACTOR);
                let ua2 = toBN(2000).mul(constants.DEFAULT_FACTOR);
                let ua3 = toBN(3000).mul(constants.DEFAULT_FACTOR);

                await groVest.vest(true, user1, ua1);
                let ai = await groVest.accountInfos(user1);
                const us1 = toBN(ai.startTime);

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(toBN(10000)).toNumber()],
                });
                await groVest.vest(true, user2, ua2);
                ai = await groVest.accountInfos(user2);
                const us2 = toBN(ai.startTime);

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(toBN(12000)).toNumber()],
                });
                await groVest.vest(true, user3, ua3);
                ai = await groVest.accountInfos(user3);
                const us3 = toBN(ai.startTime);

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [
                        toBN(b.timestamp)
                            .add(maxPeriod.div(toBN(4)))
                            .toNumber(),
                    ],
                });
                let eAmount = toBN(500).mul(constants.DEFAULT_FACTOR);
                await groVest.exit(eAmount, {from: user2});
                ua2 = ua2.sub(eAmount);

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(toBN(3000)).toNumber()],
                });
                await groVest.setVester(deployer, true);

                b = await web3.eth.getBlock("latest");
                let totalVestingAmount = calcTotalVestingAmount(
                    [ua1, ua2, ua3],
                    [us1, us2, us3],
                    toBN(b.timestamp),
                    maxPeriod
                );
                await expect(groVest.totalGroove()).to.eventually.be.a.bignumber.closeTo(
                    totalVestingAmount,
                    constants.DEFAULT_FACTOR
                );

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(toBN(15000)).toNumber()],
                });
                await groVest.exit(INIT_MAX_TOTAL_SUPPLY, {from: user2});

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(toBN(3000)).toNumber()],
                });
                await groVest.setVester(deployer, true);

                b = await web3.eth.getBlock("latest");
                totalVestingAmount = calcTotalVestingAmount([ua1, ua3], [us1, us3], toBN(b.timestamp), maxPeriod);
                await expect(groVest.totalGroove()).to.eventually.be.a.bignumber.closeTo(
                    totalVestingAmount,
                    constants.DEFAULT_FACTOR
                );

                return;
            });

            it("extend", async () => {
                const uas = [
                    toBN(1000).mul(constants.DEFAULT_FACTOR),
                    toBN(2000).mul(constants.DEFAULT_FACTOR),
                    toBN(3000).mul(constants.DEFAULT_FACTOR),
                ];
                const uss = [];

                await groVest.vest(true, user1, uas[0]);
                let ai = await groVest.accountInfos(user1);
                uss.push(toBN(ai.startTime));

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(toBN(10000)).toNumber()],
                });
                await groVest.vest(true, user2, uas[1]);
                ai = await groVest.accountInfos(user2);
                uss.push(toBN(ai.startTime));

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(toBN(12000)).toNumber()],
                });
                await groVest.vest(true, user3, uas[2]);
                ai = await groVest.accountInfos(user3);
                uss.push(toBN(ai.startTime));

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [
                        toBN(b.timestamp)
                            .add(maxPeriod.div(toBN(3)))
                            .toNumber(),
                    ],
                });
                await groVest.extend(constants.PERCENT_FACTOR, {from: user1});
                ai = await groVest.accountInfos(user1);
                uss[0] = toBN(ai.startTime);

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(toBN(3000)).toNumber()],
                });
                await groVest.setVester(deployer, true);

                b = await web3.eth.getBlock("latest");
                const totalVestingAmount = calcTotalVestingAmount(uas, uss, toBN(b.timestamp), maxPeriod);
                await expect(groVest.totalGroove()).to.eventually.be.a.bignumber.closeTo(
                    totalVestingAmount,
                    constants.DEFAULT_FACTOR
                );

                return;
            });

            it("add after expiration", async () => {
                const uas = [
                    toBN(1000).mul(constants.DEFAULT_FACTOR),
                    toBN(2000).mul(constants.DEFAULT_FACTOR),
                    toBN(3000).mul(constants.DEFAULT_FACTOR),
                ];
                let uss = [];

                await groVest.vest(true, user1, uas[0]);
                let ai = await groVest.accountInfos(user1);
                uss.push(toBN(ai.startTime));

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(toBN(10000)).toNumber()],
                });
                await groVest.vest(true, user2, uas[1]);
                ai = await groVest.accountInfos(user2);
                uss.push(toBN(ai.startTime));

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(toBN(12000)).toNumber()],
                });
                await groVest.vest(true, user3, uas[2]);
                ai = await groVest.accountInfos(user3);
                uss.push(toBN(ai.startTime));

                b = await web3.eth.getBlock("latest");
                let totalVestingAmount = calcTotalVestingAmount(uas, uss, toBN(b.timestamp), maxPeriod);
                await expect(groVest.totalGroove()).to.eventually.be.a.bignumber.closeTo(
                    totalVestingAmount,
                    constants.DEFAULT_FACTOR
                );

                // 1st vesting after expiration
                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(maxPeriod).toNumber()],
                });
                await network.provider.send("evm_mine");
                ai = await groVest.accountInfos(user1);
                b = await web3.eth.getBlock("latest");
                let newStartTime = await calcNewStartDate(uas[2], ai.total, toBN(b.timestamp), ai.startTime, maxPeriod);
                await groVest.vest(true, user1, uas[2]);
                await groVest.vest(false, user2, uas[0]);

                ai = await groVest.accountInfos(user1);
                assert.approximately(newStartTime.toNumber(), ai.startTime.toNumber(), 1, "startdates are close");

                uas[0] = uas[0].add(uas[2]);
                uss[0] = toBN(newStartTime);
                b = await web3.eth.getBlock("latest");
                vesting = calcNewVesting(ai.startTime, toBN(b.timestamp), ai.total, maxPeriod);
                totalVestingAmount = calcTotalVestingAmount(uas, uss, toBN(b.timestamp), maxPeriod);
                await expect(groVest.totalGroove()).to.eventually.be.a.bignumber.closeTo(
                    totalVestingAmount,
                    constants.DEFAULT_FACTOR
                );

                // 2nd vesting after expiration
                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(toBN(1000)).toNumber()],
                });
                await network.provider.send("evm_mine");
                ai = await groVest.accountInfos(user1);
                b = await web3.eth.getBlock("latest");
                newStartTime = await calcNewStartDate(uas[1], ai.total, toBN(b.timestamp), ai.startTime, maxPeriod);
                await groVest.vest(true, user1, uas[1]);
                await groVest.vest(false, user3, uas[2]);

                ai = await groVest.accountInfos(user1);
                assert.approximately(newStartTime.toNumber(), ai.startTime.toNumber(), 1, "startdates are close");

                uas[0] = uas[0].add(uas[1]);
                uss[0] = toBN(newStartTime);
                b = await web3.eth.getBlock("latest");
                vesting = calcNewVesting(ai.startTime, toBN(b.timestamp), ai.total, maxPeriod);

                b = await web3.eth.getBlock("latest");
                totalVestingAmount = calcTotalVestingAmount(uas, uss, toBN(b.timestamp), maxPeriod);
                await expect(groVest.totalGroove()).to.eventually.be.a.bignumber.closeTo(
                    totalVestingAmount,
                    constants.DEFAULT_FACTOR
                );

                return;
            });

            it("exit after expiration", async () => {
                let ua1 = toBN(1000).mul(constants.DEFAULT_FACTOR);
                let ua2 = toBN(2000).mul(constants.DEFAULT_FACTOR);
                let ua3 = toBN(3000).mul(constants.DEFAULT_FACTOR);

                await groVest.vest(true, user1, ua1);
                let ai = await groVest.accountInfos(user1);
                const us1 = toBN(ai.startTime);

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(toBN(10000)).toNumber()],
                });
                await groVest.vest(true, user2, ua2);
                ai = await groVest.accountInfos(user2);
                const us2 = toBN(ai.startTime);

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(toBN(12000)).toNumber()],
                });
                await groVest.vest(true, user3, ua3);
                ai = await groVest.accountInfos(user3);
                const us3 = toBN(ai.startTime);

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [us1.add(maxPeriod).add(toBN(2)).toNumber()],
                });
                let eAmount = ua1.div(toBN(2));
                await groVest.exit(eAmount, {from: user1});

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(toBN(100)).toNumber()],
                });
                await groVest.setVester(deployer, true);

                b = await web3.eth.getBlock("latest");
                let totalVestingAmount = calcTotalVestingAmount(
                    [ua1, ua2, ua3],
                    [us1, us2, us3],
                    toBN(b.timestamp),
                    maxPeriod
                );
                await expect(groVest.totalGroove()).to.eventually.be.a.bignumber.closeTo(
                    totalVestingAmount,
                    constants.DEFAULT_FACTOR
                );

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(toBN(10000)).toNumber()],
                });
                await groVest.exit(INIT_MAX_TOTAL_SUPPLY, {from: user1});

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(toBN(100)).toNumber()],
                });
                await groVest.setVester(deployer, true);

                b = await web3.eth.getBlock("latest");
                totalVestingAmount = calcTotalVestingAmount([ua2, ua3], [us2, us3], toBN(b.timestamp), maxPeriod);
                await expect(groVest.totalGroove()).to.eventually.be.a.bignumber.closeTo(
                    totalVestingAmount,
                    constants.DEFAULT_FACTOR
                );

                return;
            });

            it("extend after expiration", async () => {
                const uas = [
                    toBN(1000).mul(constants.DEFAULT_FACTOR),
                    toBN(2000).mul(constants.DEFAULT_FACTOR),
                    toBN(3000).mul(constants.DEFAULT_FACTOR),
                ];
                const uss = [];

                await groVest.vest(true, user1, uas[0]);
                let ai = await groVest.accountInfos(user1);
                uss.push(toBN(ai.startTime));

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(toBN(10000)).toNumber()],
                });
                await groVest.vest(true, user2, uas[1]);
                ai = await groVest.accountInfos(user2);
                uss.push(toBN(ai.startTime));

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(toBN(12000)).toNumber()],
                });
                await groVest.vest(true, user3, uas[2]);
                ai = await groVest.accountInfos(user3);
                uss.push(toBN(ai.startTime));

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [uss[0].add(maxPeriod).add(toBN(100)).toNumber()],
                });
                await groVest.extend(constants.PERCENT_FACTOR, {from: user1});
                ai = await groVest.accountInfos(user1);
                uss[0] = toBN(ai.startTime);

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(toBN(300)).toNumber()],
                });
                await groVest.setVester(deployer, true);

                b = await web3.eth.getBlock("latest");
                const totalVestingAmount = calcTotalVestingAmount(uas, uss, toBN(b.timestamp), maxPeriod);
                await expect(groVest.totalGroove()).to.eventually.be.a.bignumber.closeTo(
                    totalVestingAmount,
                    constants.DEFAULT_FACTOR
                );

                return;
            });

            it("multiple actions", async () => {
                // user1 vests
                // user2 vests
                // user3 vests
                // user1 vests
                // user1 vests
                // user1 exits partially
                // user2 extends
                // migrates to new one
                // user1 exits
                // user2 vests
                // user3 vests instantly
                // user2 exits partially
                // user1 vests
                // user2 exits
                // user3 extends
                // user3 vests

                const amount1 = toBN(1000).mul(constants.DEFAULT_FACTOR);
                const amount2 = toBN(2000).mul(constants.DEFAULT_FACTOR);
                const amount3 = toBN(3000).mul(constants.DEFAULT_FACTOR);

                let ua1 = toBN(0),
                    ua2 = toBN(0),
                    ua3 = toBN(0),
                    us1 = toBN(0),
                    us2 = toBN(0),
                    us3 = toBN(0);

                await groVest.vest(true, user1, amount1);
                let ai = await groVest.accountInfos(user1);
                ua1 = ua1.add(amount1);
                us1 = toBN(ai.startTime);

                b = await web3.eth.getBlock("latest");
                let totalVestingAmount = calcTotalVestingAmount(
                    [ua1, ua2, ua3],
                    [us1, us2, us3],
                    toBN(b.timestamp),
                    maxPeriod
                );
                await expect(groVest.totalGroove()).to.eventually.be.a.bignumber.closeTo(
                    totalVestingAmount,
                    constants.DEFAULT_FACTOR
                );

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [
                        toBN(b.timestamp)
                            .add(maxPeriod.div(toBN(4)))
                            .toNumber(),
                    ],
                });
                await groVest.vest(true, user2, amount2);
                ai = await groVest.accountInfos(user2);
                ua2 = ua2.add(amount2);
                us2 = toBN(ai.startTime);

                b = await web3.eth.getBlock("latest");
                totalVestingAmount = calcTotalVestingAmount(
                    [ua1, ua2, ua3],
                    [us1, us2, us3],
                    toBN(b.timestamp),
                    maxPeriod
                );
                await expect(groVest.totalGroove()).to.eventually.be.a.bignumber.closeTo(
                    totalVestingAmount,
                    constants.DEFAULT_FACTOR
                );

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [
                        toBN(b.timestamp)
                            .add(maxPeriod.div(toBN(3)))
                            .toNumber(),
                    ],
                });
                await groVest.vest(true, user3, amount3);
                ai = await groVest.accountInfos(user3);
                ua3 = ua3.add(amount3);
                us3 = toBN(ai.startTime);

                b = await web3.eth.getBlock("latest");
                totalVestingAmount = calcTotalVestingAmount(
                    [ua1, ua2, ua3],
                    [us1, us2, us3],
                    toBN(b.timestamp),
                    maxPeriod
                );
                await expect(groVest.totalGroove()).to.eventually.be.a.bignumber.closeTo(
                    totalVestingAmount,
                    constants.DEFAULT_FACTOR
                );

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [us1.add(maxPeriod).add(toBN(100)).toNumber()],
                });
                await groVest.vest(true, user1, amount2);
                ai = await groVest.accountInfos(user1);
                ua1 = ua1.add(amount2);
                us1 = toBN(ai.startTime);

                b = await web3.eth.getBlock("latest");
                totalVestingAmount = calcTotalVestingAmount(
                    [ua1, ua2, ua3],
                    [us1, us2, us3],
                    toBN(b.timestamp),
                    maxPeriod
                );
                await expect(groVest.totalGroove()).to.eventually.be.a.bignumber.closeTo(
                    totalVestingAmount,
                    constants.DEFAULT_FACTOR
                );

                await groVest.vest(false, user2, amount1);

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(toBN(500)).toNumber()],
                });
                await groVest.vest(true, user1, amount3);
                ai = await groVest.accountInfos(user1);
                ua1 = ua1.add(amount3);
                us1 = toBN(ai.startTime);

                b = await web3.eth.getBlock("latest");
                totalVestingAmount = calcTotalVestingAmount(
                    [ua1, ua2, ua3],
                    [us1, us2, us3],
                    toBN(b.timestamp),
                    maxPeriod
                );
                await expect(groVest.totalGroove()).to.eventually.be.a.bignumber.closeTo(
                    totalVestingAmount,
                    constants.DEFAULT_FACTOR
                );

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(toBN(500)).toNumber()],
                });
                let eAmount = ua1.div(toBN(5));
                await groVest.exit(eAmount, {from: user1});
                ua1 = ua1.sub(eAmount);

                b = await web3.eth.getBlock("latest");
                totalVestingAmount = calcTotalVestingAmount(
                    [ua1, ua2, ua3],
                    [us1, us2, us3],
                    toBN(b.timestamp),
                    maxPeriod
                );
                await expect(groVest.totalGroove()).to.eventually.be.a.bignumber.closeTo(
                    totalVestingAmount,
                    constants.DEFAULT_FACTOR
                );

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(toBN(500)).toNumber()],
                });
                await groVest.extend(9500, {from: user2});
                ai = await groVest.accountInfos(user2);
                us2 = toBN(ai.startTime);

                b = await web3.eth.getBlock("latest");
                totalVestingAmount = calcTotalVestingAmount(
                    [ua1, ua2, ua3],
                    [us1, us2, us3],
                    toBN(b.timestamp),
                    maxPeriod
                );
                await expect(groVest.totalGroove()).to.eventually.be.a.bignumber.closeTo(
                    totalVestingAmount,
                    constants.DEFAULT_FACTOR
                );

                const newGroVest = await redeployVesting();

                b = await web3.eth.getBlock("latest");
                totalVestingAmount = calcTotalVestingAmount(
                    [ua1, ua2, ua3],
                    [us1, us2, us3],
                    toBN(b.timestamp),
                    maxPeriod
                );
                await expect(newGroVest.totalGroove()).to.eventually.be.a.bignumber.closeTo(
                    totalVestingAmount,
                    constants.DEFAULT_FACTOR
                );

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(toBN(500)).toNumber()],
                });
                await newGroVest.exit(INIT_MAX_TOTAL_SUPPLY, {from: user1});
                ua1 = toBN(0);

                b = await web3.eth.getBlock("latest");
                totalVestingAmount = calcTotalVestingAmount(
                    [ua1, ua2, ua3],
                    [us1, us2, us3],
                    toBN(b.timestamp),
                    maxPeriod
                );
                await expect(newGroVest.totalGroove()).to.eventually.be.a.bignumber.closeTo(
                    totalVestingAmount,
                    constants.DEFAULT_FACTOR
                );

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(toBN(500)).toNumber()],
                });
                await newGroVest.vest(true, user2, amount1);
                ua2 = ua2.add(amount1);

                b = await web3.eth.getBlock("latest");
                totalVestingAmount = calcTotalVestingAmount(
                    [ua1, ua2, ua3],
                    [us1, us2, us3],
                    toBN(b.timestamp),
                    maxPeriod
                );
                await expect(newGroVest.totalGroove()).to.eventually.be.a.bignumber.closeTo(
                    totalVestingAmount,
                    constants.DEFAULT_FACTOR
                );

                await newGroVest.vest(false, user3, amount3);

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(toBN(500)).toNumber()],
                });
                eAmount = ua2.div(toBN(4));
                await newGroVest.exit(eAmount, {from: user2});
                ua2 = ua2.sub(eAmount);

                b = await web3.eth.getBlock("latest");
                totalVestingAmount = calcTotalVestingAmount(
                    [ua1, ua2, ua3],
                    [us1, us2, us3],
                    toBN(b.timestamp),
                    maxPeriod
                );
                await expect(newGroVest.totalGroove()).to.eventually.be.a.bignumber.closeTo(
                    totalVestingAmount,
                    constants.DEFAULT_FACTOR
                );

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(toBN(500)).toNumber()],
                });
                await newGroVest.vest(true, user1, amount1);
                ua1 = ua1.add(amount1);
                ai = await newGroVest.accountInfos(user1);
                us1 = toBN(ai.startTime);

                b = await web3.eth.getBlock("latest");
                totalVestingAmount = calcTotalVestingAmount(
                    [ua1, ua2, ua3],
                    [us1, us2, us3],
                    toBN(b.timestamp),
                    maxPeriod
                );
                await expect(newGroVest.totalGroove()).to.eventually.be.a.bignumber.closeTo(
                    totalVestingAmount,
                    constants.DEFAULT_FACTOR
                );

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(toBN(2500000)).toNumber()],
                });
                await newGroVest.exit(INIT_MAX_TOTAL_SUPPLY, {from: user2});
                ua2 = toBN(0);

                b = await web3.eth.getBlock("latest");
                totalVestingAmount = calcTotalVestingAmount(
                    [ua1, ua2, ua3],
                    [us1, us2, us3],
                    toBN(b.timestamp),
                    maxPeriod
                );
                await expect(newGroVest.totalGroove()).to.eventually.be.a.bignumber.closeTo(
                    totalVestingAmount,
                    constants.DEFAULT_FACTOR
                );

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(toBN(1000)).toNumber()],
                });
                await newGroVest.extend(9000, {from: user3});
                ai = await newGroVest.accountInfos(user3);
                us3 = toBN(ai.startTime);

                b = await web3.eth.getBlock("latest");
                totalVestingAmount = calcTotalVestingAmount(
                    [ua1, ua2, ua3],
                    [us1, us2, us3],
                    toBN(b.timestamp),
                    maxPeriod
                );
                await expect(newGroVest.totalGroove()).to.eventually.be.a.bignumber.closeTo(
                    totalVestingAmount,
                    constants.DEFAULT_FACTOR
                );

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [toBN(b.timestamp).add(toBN(5000)).toNumber()],
                });
                await newGroVest.vest(true, user3, amount2);
                ua3 = ua3.add(amount2);

                b = await web3.eth.getBlock("latest");
                totalVestingAmount = calcTotalVestingAmount(
                    [ua1, ua2, ua3],
                    [us1, us2, us3],
                    toBN(b.timestamp),
                    maxPeriod
                );
                await expect(newGroVest.totalGroove()).to.eventually.be.a.bignumber.closeTo(
                    totalVestingAmount,
                    constants.DEFAULT_FACTOR
                );

                return;
            });
        });
    });

    describe("migrate from v1", function () {
        let maxPeriod;

        beforeEach(async function () {
            gro = await GROToken.new("GRO", "GRO", INIT_MAX_TOTAL_SUPPLY, NON_INFLATION_PERIOD, {from: groDeployer});
            groVest = await GROVestingV1.new(1000);
            let vesters = [vester1, vester2, vester3, groVest.address];
            groDist = await GRODistributer.new(gro.address, vesters, burner);
            await gro.setDistributer(groDist.address, {from: groDeployer});
            await groVest.setDistributer(groDist.address);
            groBonus = await GROHodlerV1.new(groVest.address, constants.ZERO_ADDRESS);

            await groVest.setVester(deployer, true);
            await groVest.setHodlerClaims(groBonus.address);

            maxPeriod = await groVest.maxLockPeriod();
        });

        async function redeployVesting(period = 0) {
            const newGroVest = await GROVesting.new(groVest.address, timeLock);
            const newGroBonus = await GROHodler.new(newGroVest.address, groBonus.address);
            await newGroVest.setHodlerClaims(newGroBonus.address);
            await newGroVest.setVester(deployer, true);

            let vesters = [vester1, vester2, vester3, newGroVest.address];
            const newGroDist = await GRODistributer.new(gro.address, vesters, burner);
            await gro.setDistributer(newGroDist.address, {from: groDeployer});
            await newGroVest.setDistributer(newGroDist.address);

            if (period > 0) {
                await newGroVest.setMaxLockPeriod(period);
            }

            await newGroVest.setStatus(false, {from: timeLock});

            return newGroVest;
        }

        it("calculate Groove", async () => {
            // user1 vests
            // user2 vests
            // user3 vests
            // user1 vests
            // user1 vests
            // user1 exits
            // user2 extends
            // migrates to new one
            // user2 vests
            // user3 vests instantly
            // user2 exits partially
            // user1 vests
            // user2 exits
            // user3 extends
            // user3 vests

            const amount1 = toBN(1000).mul(constants.DEFAULT_FACTOR);
            const amount2 = toBN(2000).mul(constants.DEFAULT_FACTOR);
            const amount3 = toBN(3000).mul(constants.DEFAULT_FACTOR);

            let ua1 = toBN(0),
                ua2 = toBN(0),
                ua3 = toBN(0),
                us1 = toBN(0),
                us2 = toBN(0),
                us3 = toBN(0);

            await groVest.vest(user1, amount1);
            let ai = await groVest.accountInfos(user1);
            ua1 = ua1.add(amount1);
            us1 = toBN(ai.startTime);

            b = await web3.eth.getBlock("latest");
            let totalVestingAmount = calcTotalVestingAmount(
                [ua1, ua2, ua3],
                [us1, us2, us3],
                toBN(b.timestamp),
                maxPeriod
            );
            await expect(groVest.totalGroove()).to.eventually.be.a.bignumber.closeTo(
                totalVestingAmount,
                constants.DEFAULT_FACTOR
            );

            b = await web3.eth.getBlock("latest");
            await network.provider.request({
                method: "evm_setNextBlockTimestamp",
                params: [
                    toBN(b.timestamp)
                        .add(maxPeriod.div(toBN(4)))
                        .toNumber(),
                ],
            });
            await groVest.vest(user2, amount2);
            ai = await groVest.accountInfos(user2);
            ua2 = ua2.add(amount2);
            us2 = toBN(ai.startTime);

            b = await web3.eth.getBlock("latest");
            totalVestingAmount = calcTotalVestingAmount([ua1, ua2, ua3], [us1, us2, us3], toBN(b.timestamp), maxPeriod);
            await expect(groVest.totalGroove()).to.eventually.be.a.bignumber.closeTo(
                totalVestingAmount,
                constants.DEFAULT_FACTOR
            );

            b = await web3.eth.getBlock("latest");
            await network.provider.request({
                method: "evm_setNextBlockTimestamp",
                params: [
                    toBN(b.timestamp)
                        .add(maxPeriod.div(toBN(3)))
                        .toNumber(),
                ],
            });
            await groVest.vest(user3, amount3);
            ai = await groVest.accountInfos(user3);
            ua3 = ua3.add(amount3);
            us3 = toBN(ai.startTime);

            b = await web3.eth.getBlock("latest");
            totalVestingAmount = calcTotalVestingAmount([ua1, ua2, ua3], [us1, us2, us3], toBN(b.timestamp), maxPeriod);
            await expect(groVest.totalGroove()).to.eventually.be.a.bignumber.closeTo(
                totalVestingAmount,
                constants.DEFAULT_FACTOR
            );

            b = await web3.eth.getBlock("latest");
            await network.provider.request({
                method: "evm_setNextBlockTimestamp",
                params: [us1.add(maxPeriod).add(toBN(100)).toNumber()],
            });
            await groVest.vest(user1, amount2);
            ai = await groVest.accountInfos(user1);
            ua1 = ua1.add(amount2);
            us1 = toBN(ai.startTime);

            b = await web3.eth.getBlock("latest");
            totalVestingAmount = calcTotalVestingAmount([ua1, ua2, ua3], [us1, us2, us3], toBN(b.timestamp), maxPeriod);
            await expect(groVest.totalGroove()).to.eventually.be.a.bignumber.closeTo(
                totalVestingAmount,
                constants.DEFAULT_FACTOR
            );

            b = await web3.eth.getBlock("latest");
            await network.provider.request({
                method: "evm_setNextBlockTimestamp",
                params: [toBN(b.timestamp).add(toBN(500)).toNumber()],
            });
            await groVest.vest(user1, amount3);
            ai = await groVest.accountInfos(user1);
            ua1 = ua1.add(amount3);
            us1 = toBN(ai.startTime);

            b = await web3.eth.getBlock("latest");
            totalVestingAmount = calcTotalVestingAmount([ua1, ua2, ua3], [us1, us2, us3], toBN(b.timestamp), maxPeriod);
            await expect(groVest.totalGroove()).to.eventually.be.a.bignumber.closeTo(
                totalVestingAmount,
                constants.DEFAULT_FACTOR
            );

            b = await web3.eth.getBlock("latest");
            await network.provider.request({
                method: "evm_setNextBlockTimestamp",
                params: [toBN(b.timestamp).add(toBN(500)).toNumber()],
            });
            await groVest.exit({from: user1});
            ua1 = toBN(0);

            b = await web3.eth.getBlock("latest");
            totalVestingAmount = calcTotalVestingAmount([ua1, ua2, ua3], [us1, us2, us3], toBN(b.timestamp), maxPeriod);
            await expect(groVest.totalGroove()).to.eventually.be.a.bignumber.closeTo(
                totalVestingAmount,
                constants.DEFAULT_FACTOR
            );

            b = await web3.eth.getBlock("latest");
            await network.provider.request({
                method: "evm_setNextBlockTimestamp",
                params: [toBN(b.timestamp).add(toBN(500)).toNumber()],
            });
            await groVest.extend(9500, {from: user2});
            ai = await groVest.accountInfos(user2);
            us2 = toBN(ai.startTime);

            b = await web3.eth.getBlock("latest");
            totalVestingAmount = calcTotalVestingAmount([ua1, ua2, ua3], [us1, us2, us3], toBN(b.timestamp), maxPeriod);
            await expect(groVest.totalGroove()).to.eventually.be.a.bignumber.closeTo(
                totalVestingAmount,
                constants.DEFAULT_FACTOR
            );

            const newGroVest = await redeployVesting();

            b = await web3.eth.getBlock("latest");
            totalVestingAmount = calcTotalVestingAmount([ua1, ua2, ua3], [us1, us2, us3], toBN(b.timestamp), maxPeriod);
            await expect(newGroVest.totalGroove()).to.eventually.be.a.bignumber.closeTo(
                totalVestingAmount,
                constants.DEFAULT_FACTOR
            );

            b = await web3.eth.getBlock("latest");
            await network.provider.request({
                method: "evm_setNextBlockTimestamp",
                params: [toBN(b.timestamp).add(toBN(500)).toNumber()],
            });
            await newGroVest.vest(true, user2, amount1);
            ua2 = ua2.add(amount1);

            b = await web3.eth.getBlock("latest");
            totalVestingAmount = calcTotalVestingAmount([ua1, ua2, ua3], [us1, us2, us3], toBN(b.timestamp), maxPeriod);
            await expect(newGroVest.totalGroove()).to.eventually.be.a.bignumber.closeTo(
                totalVestingAmount,
                constants.DEFAULT_FACTOR
            );

            await newGroVest.vest(false, user3, amount3);

            b = await web3.eth.getBlock("latest");
            await network.provider.request({
                method: "evm_setNextBlockTimestamp",
                params: [toBN(b.timestamp).add(toBN(500)).toNumber()],
            });
            eAmount = ua2.div(toBN(4));
            await newGroVest.exit(eAmount, {from: user2});
            ua2 = ua2.sub(eAmount);

            b = await web3.eth.getBlock("latest");
            totalVestingAmount = calcTotalVestingAmount([ua1, ua2, ua3], [us1, us2, us3], toBN(b.timestamp), maxPeriod);
            await expect(newGroVest.totalGroove()).to.eventually.be.a.bignumber.closeTo(
                totalVestingAmount,
                constants.DEFAULT_FACTOR
            );

            b = await web3.eth.getBlock("latest");
            await network.provider.request({
                method: "evm_setNextBlockTimestamp",
                params: [toBN(b.timestamp).add(toBN(500)).toNumber()],
            });
            await newGroVest.vest(true, user1, amount1);
            ua1 = ua1.add(amount1);
            ai = await newGroVest.accountInfos(user1);
            us1 = toBN(ai.startTime);

            b = await web3.eth.getBlock("latest");
            totalVestingAmount = calcTotalVestingAmount([ua1, ua2, ua3], [us1, us2, us3], toBN(b.timestamp), maxPeriod);
            await expect(newGroVest.totalGroove()).to.eventually.be.a.bignumber.closeTo(
                totalVestingAmount,
                constants.DEFAULT_FACTOR
            );

            b = await web3.eth.getBlock("latest");
            await network.provider.request({
                method: "evm_setNextBlockTimestamp",
                params: [toBN(b.timestamp).add(toBN(2500000)).toNumber()],
            });
            await newGroVest.exit(INIT_MAX_TOTAL_SUPPLY, {from: user2});
            ua2 = toBN(0);

            b = await web3.eth.getBlock("latest");
            totalVestingAmount = calcTotalVestingAmount([ua1, ua2, ua3], [us1, us2, us3], toBN(b.timestamp), maxPeriod);
            await expect(newGroVest.totalGroove()).to.eventually.be.a.bignumber.closeTo(
                totalVestingAmount,
                constants.DEFAULT_FACTOR
            );

            b = await web3.eth.getBlock("latest");
            await network.provider.request({
                method: "evm_setNextBlockTimestamp",
                params: [toBN(b.timestamp).add(toBN(1000)).toNumber()],
            });
            await newGroVest.extend(9000, {from: user3});
            ai = await newGroVest.accountInfos(user3);
            us3 = toBN(ai.startTime);

            b = await web3.eth.getBlock("latest");
            totalVestingAmount = calcTotalVestingAmount([ua1, ua2, ua3], [us1, us2, us3], toBN(b.timestamp), maxPeriod);
            await expect(newGroVest.totalGroove()).to.eventually.be.a.bignumber.closeTo(
                totalVestingAmount,
                constants.DEFAULT_FACTOR
            );

            b = await web3.eth.getBlock("latest");
            await network.provider.request({
                method: "evm_setNextBlockTimestamp",
                params: [toBN(b.timestamp).add(toBN(5000)).toNumber()],
            });
            await newGroVest.vest(true, user3, amount2);
            ua3 = ua3.add(amount2);

            b = await web3.eth.getBlock("latest");
            totalVestingAmount = calcTotalVestingAmount([ua1, ua2, ua3], [us1, us2, us3], toBN(b.timestamp), maxPeriod);
            await expect(newGroVest.totalGroove()).to.eventually.be.a.bignumber.closeTo(
                totalVestingAmount,
                constants.DEFAULT_FACTOR
            );

            return;
        });

        it("vest", async () => {
            const period = toBN(1000);
            const modified_vesting = constants.ONE_YEAR_SECONDS.mul(period).div(toBN(10000));
            await groVest.setMaxLockPeriod(period);

            // 1st vesting
            const amount = toBN(10000).mul(constants.DEFAULT_FACTOR);
            const pct = await groVest.initUnlockedPercent();

            await groVest.vest(deployer, amount);
            let total = amount;
            let initAmount = total.mul(pct).div(constants.PERCENT_FACTOR);
            await expect(groVest.totalBalance(deployer)).to.eventually.be.a.bignumber.equal(total);
            await expect(groVest.vestedBalance(deployer)).to.eventually.be.a.bignumber.equal(initAmount);
            await expect(groVest.vestingBalance(deployer)).to.eventually.be.a.bignumber.equal(total.sub(initAmount));
            maxPeriod = await groVest.maxLockPeriod();

            // 2nd vesting
            let b = await web3.eth.getBlock("latest");
            let setTime = toBN(b.timestamp).add(modified_vesting.div(toBN(4)));
            await network.provider.request({
                method: "evm_setNextBlockTimestamp",
                params: [setTime.toNumber()],
            });

            let ai = await groVest.accountInfos(deployer);
            let newStartTime = await calcNewStartDate(amount, ai.total, toBN(setTime), ai.startTime, maxPeriod);
            await groVest.vest(deployer, amount);
            ai = await groVest.accountInfos(deployer);
            total = total.add(amount);
            assert.approximately(newStartTime.toNumber(), ai.startTime.toNumber(), 1, "startdates are close");
            assert.strictEqual(total.toString(), ai.total.toString());
            vesting = calcNewVesting(ai.startTime, setTime, total, maxPeriod);
            await expect(groVest.totalBalance(deployer)).to.eventually.be.a.bignumber.equal(total);
            await expect(groVest.vestedBalance(deployer)).to.eventually.be.a.bignumber.closeTo(
                total.sub(vesting),
                toBN(1e18)
            );
            await expect(groVest.vestingBalance(deployer)).to.eventually.be.a.bignumber.closeTo(vesting, toBN(1e18));

            const newGroVest = await redeployVesting(period);

            // 3rd vesting
            b = await web3.eth.getBlock("latest");
            setTime = toBN(b.timestamp).add(modified_vesting.div(toBN(2)));
            await network.provider.request({
                method: "evm_setNextBlockTimestamp",
                params: [setTime.toNumber()],
            });

            ai = await groVest.accountInfos(deployer);
            newStartTime = await calcNewStartDate(amount, ai.total, toBN(setTime), ai.startTime, maxPeriod);
            await newGroVest.vest(true, deployer, amount);
            ai = await newGroVest.accountInfos(deployer);
            total = total.add(amount);
            assert.approximately(newStartTime.toNumber(), ai.startTime.toNumber(), 1, "startdates are close");
            assert.strictEqual(total.toString(), ai.total.toString());
            vesting = calcNewVesting(ai.startTime, setTime, total, maxPeriod);
            await expect(newGroVest.totalBalance(deployer)).to.eventually.be.a.bignumber.equal(total);
            await expect(newGroVest.vestedBalance(deployer)).to.eventually.be.a.bignumber.closeTo(
                total.sub(vesting),
                toBN(1e18)
            );
            await expect(newGroVest.vestingBalance(deployer)).to.eventually.be.a.bignumber.closeTo(vesting, toBN(1e18));

            // 4th vesting
            b = await web3.eth.getBlock("latest");
            setTime = toBN(b.timestamp).add(modified_vesting);
            await network.provider.request({
                method: "evm_setNextBlockTimestamp",
                params: [setTime.toNumber()],
            });

            ai = await newGroVest.accountInfos(deployer);
            newStartTime = await calcNewStartDate(amount, ai.total, toBN(setTime), ai.startTime, maxPeriod);
            await newGroVest.vest(true, deployer, amount);
            ai = await newGroVest.accountInfos(deployer);
            total = total.add(amount);
            assert.approximately(newStartTime, ai.startTime.toNumber(), 1, "startdates are close");
            assert.strictEqual(total.toString(), ai.total.toString());
            vesting = calcNewVesting(ai.startTime, setTime, total, maxPeriod);
            await expect(newGroVest.totalBalance(deployer)).to.eventually.be.a.bignumber.equal(total);
            await expect(newGroVest.vestedBalance(deployer)).to.eventually.be.a.bignumber.closeTo(
                total.sub(vesting),
                toBN(1)
            );
            await expect(newGroVest.vestingBalance(deployer)).to.eventually.be.a.bignumber.closeTo(vesting, toBN(1));

            return;
        });

        it("extend", async () => {
            const period = toBN(1000);
            const modified_vesting = constants.ONE_YEAR_SECONDS.mul(period).div(toBN(10000));
            await groVest.setMaxLockPeriod(period);
            const amount = toBN(10000).mul(constants.DEFAULT_FACTOR);
            const pct = await groVest.initUnlockedPercent();
            const initAmount = amount.mul(pct).div(constants.PERCENT_FACTOR);

            await groVest.vest(deployer, amount);

            let b = await web3.eth.getBlock("latest");
            await network.provider.request({
                method: "evm_setNextBlockTimestamp",
                params: [
                    toBN(b.timestamp)
                        .add(modified_vesting.sub(modified_vesting.div(toBN(4))))
                        .toNumber(),
                ],
            });
            await groVest.extend(2500);
            await expect(groVest.totalBalance(deployer)).to.eventually.be.a.bignumber.equal(amount);
            await expect(groVest.vestedBalance(deployer)).to.eventually.be.a.bignumber.closeTo(
                amount.sub(amount.sub(initAmount).div(toBN(2))),
                toBN(1e18)
            );
            await expect(groVest.vestingBalance(deployer)).to.eventually.be.a.bignumber.closeTo(
                amount.sub(initAmount).div(toBN(2)),
                toBN(1e18)
            );

            const newGroVest = await redeployVesting(period);

            b = await web3.eth.getBlock("latest");
            await network.provider.request({
                method: "evm_setNextBlockTimestamp",
                params: [toBN(b.timestamp).add(modified_vesting).toNumber()],
            });
            await network.provider.send("evm_mine");
            await expect(newGroVest.totalBalance(deployer)).to.eventually.be.a.bignumber.equal(amount);
            await expect(newGroVest.vestedBalance(deployer)).to.eventually.be.a.bignumber.equal(amount);
            await expect(newGroVest.vestingBalance(deployer)).to.eventually.be.a.bignumber.equal(toBN(0));

            await newGroVest.extend(10000);
            await expect(newGroVest.totalBalance(deployer)).to.eventually.be.a.bignumber.equal(amount);
            await expect(newGroVest.vestedBalance(deployer)).to.eventually.be.a.bignumber.equal(initAmount);
            await expect(newGroVest.vestingBalance(deployer)).to.eventually.be.a.bignumber.equal(
                amount.sub(initAmount)
            );

            const ai = await newGroVest.accountInfos(deployer);
            b = await web3.eth.getBlock("latest");
            await network.provider.request({
                method: "evm_setNextBlockTimestamp",
                params: [
                    toBN(b.timestamp)
                        .add(modified_vesting.div(toBN(3)))
                        .toNumber(),
                ],
            });
            await newGroVest.setMaxLockPeriod(period);
            b = await web3.eth.getBlock("latest");
            const vesting = calcNewVesting(ai.startTime, toBN(b.timestamp), ai.total, modified_vesting);
            await expect(newGroVest.totalBalance(deployer)).to.eventually.be.a.bignumber.equal(amount);
            await expect(newGroVest.vestingBalance(deployer)).to.eventually.be.a.bignumber.equal(vesting);
            await expect(newGroVest.vestedBalance(deployer)).to.eventually.be.a.bignumber.equal(amount.sub(vesting));

            b = await web3.eth.getBlock("latest");
            await network.provider.request({
                method: "evm_setNextBlockTimestamp",
                params: [toBN(b.timestamp).add(modified_vesting).toNumber()],
            });
            await newGroVest.setMaxLockPeriod(period);
            await expect(newGroVest.totalBalance(deployer)).to.eventually.be.a.bignumber.equal(amount);
            await expect(newGroVest.vestedBalance(deployer)).to.eventually.be.a.bignumber.equal(amount);
            await expect(newGroVest.vestingBalance(deployer)).to.eventually.be.a.bignumber.equal(toBN(0));

            return;
        });

        it("exit during vesting period", async () => {
            const period = toBN(1000);
            const modified_vesting = constants.ONE_YEAR_SECONDS.mul(period).div(toBN(10000));
            await groVest.setMaxLockPeriod(period);
            const amount = toBN(10000).mul(constants.DEFAULT_FACTOR);
            const pct = await groVest.initUnlockedPercent();
            const initAmount = amount.mul(pct).div(constants.PERCENT_FACTOR);

            await groVest.vest(groDeployer, amount);
            await groVest.vest(deployer, amount);
            await expect(groVest.totalLockedAmount()).to.eventually.be.a.bignumber.equal(amount.mul(toBN(2)));

            const b = await web3.eth.getBlock("latest");
            await network.provider.request({
                method: "evm_setNextBlockTimestamp",
                params: [
                    toBN(b.timestamp)
                        .add(modified_vesting.div(toBN(10)))
                        .toNumber(),
                ],
            });
            await groVest.setMaxLockPeriod(period);
            const ai = await groVest.accountInfos(deployer);

            const newGroVest = await redeployVesting(period);

            await network.provider.request({
                method: "evm_setNextBlockTimestamp",
                params: [
                    toBN(ai.startTime)
                        .add(modified_vesting.div(toBN(4)))
                        .toNumber(),
                ],
            });
            let tw = await newGroVest.totalWithdrawn(deployer);
            let bo = await gro.balanceOf(deployer);
            await newGroVest.exit(INIT_MAX_TOTAL_SUPPLY);

            unlocked = initAmount.add(amount.sub(initAmount).div(toBN(4)));
            await expect(newGroVest.totalBalance(deployer)).to.eventually.be.a.bignumber.equal(toBN(0));
            await expect(newGroVest.vestedBalance(deployer)).to.eventually.be.a.bignumber.equal(toBN(0));
            await expect(newGroVest.vestingBalance(deployer)).to.eventually.be.a.bignumber.equal(toBN(0));
            await expect(newGroVest.totalWithdrawn(deployer)).to.eventually.be.a.bignumber.closeTo(
                tw.add(unlocked),
                toBN(1e16)
            );
            await expect(gro.balanceOf(deployer)).to.eventually.be.a.bignumber.closeTo(bo.add(unlocked), toBN(1e16));
            await expect(newGroVest.totalBalance(groDeployer)).to.eventually.be.a.bignumber.equal(amount);
            await expect(newGroVest.totalLockedAmount()).to.eventually.be.a.bignumber.equal(amount);

            return;
        });

        it("exit after vesting period", async () => {
            const period = toBN(1000);
            const modified_vesting = constants.ONE_YEAR_SECONDS.mul(period).div(toBN(10000));
            await groVest.setMaxLockPeriod(period);
            const amount = toBN(10000).mul(constants.DEFAULT_FACTOR);
            const pct = await groVest.initUnlockedPercent();
            const initAmount = amount.mul(pct).div(constants.PERCENT_FACTOR);

            await groVest.vest(deployer, amount);

            let b = await web3.eth.getBlock("latest");
            await network.provider.request({
                method: "evm_setNextBlockTimestamp",
                params: [
                    toBN(b.timestamp)
                        .add(modified_vesting.div(toBN(2)))
                        .toNumber(),
                ],
            });
            await groVest.vest(groDeployer, amount);
            await expect(groVest.totalLockedAmount()).to.eventually.be.a.bignumber.equal(amount.mul(toBN(2)));

            const newGroVest = await redeployVesting(period);

            b = await web3.eth.getBlock("latest");
            await network.provider.request({
                method: "evm_setNextBlockTimestamp",
                params: [
                    toBN(b.timestamp)
                        .add(modified_vesting.div(toBN(2)))
                        .toNumber(),
                ],
            });
            let eAmount = amount.div(toBN(4));
            let lAmount = amount.sub(eAmount);
            await newGroVest.exit(eAmount);

            await expect(newGroVest.totalBalance(deployer)).to.eventually.be.a.bignumber.equal(lAmount);
            await expect(newGroVest.vestedBalance(deployer)).to.eventually.be.a.bignumber.closeTo(lAmount, toBN(1e16));
            await expect(newGroVest.vestingBalance(deployer)).to.eventually.be.a.bignumber.closeTo(toBN(0), toBN(1e16));
            await expect(newGroVest.totalWithdrawn(deployer)).to.eventually.be.a.bignumber.closeTo(eAmount, toBN(1e16));
            await expect(gro.balanceOf(deployer)).to.eventually.be.a.bignumber.closeTo(eAmount, toBN(1e16));
            await expect(newGroVest.totalBalance(groDeployer)).to.eventually.be.a.bignumber.equal(amount);
            await expect(newGroVest.totalLockedAmount()).to.eventually.be.a.bignumber.equal(amount.add(lAmount));
            //NOTE check
            await expect(newGroVest.vestedBalance(groDeployer)).to.eventually.be.a.bignumber.closeTo(
                amount.sub(amount.sub(initAmount).div(toBN(2))),
                toBN(1e18)
            );
            await expect(newGroVest.vestingBalance(groDeployer)).to.eventually.be.a.bignumber.closeTo(
                amount.sub(initAmount).div(toBN(2)),
                toBN(1e18)
            );

            b = await web3.eth.getBlock("latest");
            await network.provider.request({
                method: "evm_setNextBlockTimestamp",
                params: [
                    toBN(b.timestamp)
                        .add(modified_vesting.div(toBN(10)))
                        .toNumber(),
                ],
            });
            let tw = await newGroVest.totalWithdrawn(deployer);
            let bo = await gro.balanceOf(deployer);
            await newGroVest.exit(INIT_MAX_TOTAL_SUPPLY);

            await expect(newGroVest.totalBalance(deployer)).to.eventually.be.a.bignumber.equal(toBN(0));
            await expect(newGroVest.vestedBalance(deployer)).to.eventually.be.a.bignumber.equal(toBN(0));
            await expect(newGroVest.vestingBalance(deployer)).to.eventually.be.a.bignumber.equal(toBN(0));
            await expect(newGroVest.totalWithdrawn(deployer)).to.eventually.be.a.bignumber.closeTo(
                tw.add(lAmount),
                toBN(1e16)
            );
            await expect(gro.balanceOf(deployer)).to.eventually.be.a.bignumber.closeTo(bo.add(lAmount), toBN(1e16));
            await expect(newGroVest.totalBalance(groDeployer)).to.eventually.be.a.bignumber.equal(amount);
            await expect(newGroVest.totalLockedAmount()).to.eventually.be.a.bignumber.equal(amount);

            const ai = await newGroVest.accountInfos(deployer);
            expect(ai.startTime).be.a.bignumber.equal(toBN(0));
            expect(ai.total).be.a.bignumber.equal(toBN(0));

            return;
        });
    });
});
