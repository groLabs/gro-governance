const {toBN} = require("web3-utils");
const GROToken = artifacts.require("GROToken");
const GRODistributer = artifacts.require("GRODistributer");
const GROVesting = artifacts.require("GROVesting");
const GROHodler = artifacts.require("GROHodler");
const GROBurner = artifacts.require("GROBurner");
const GROBurnerV1 = artifacts.require("GROBurnerV1");
const LPTokenStaker = artifacts.require("LPTokenStaker");
const LPTokenStakerV1 = artifacts.require("LPTokenStakerV1");
const MockTokenWithOwner = artifacts.require("MockTokenWithOwner");
const MockMigrator = artifacts.require("MockMigrator");
const GROEmpVesting = artifacts.require("GROEmpVesting");
const GROInvVesting = artifacts.require("GROInvVesting");
const GRODaoVesting = artifacts.require("GRODaoVesting");
const GROVestingV1 = artifacts.require("GROVestingV1");
const GROHodlerV1 = artifacts.require("GROHodlerV1");
const {constants} = require("../utils/constants");
const {expect} = require("../utils/common-utils");

contract("Smoke Vesting tests", function (accounts) {
    const INIT_MAX_TOTAL_SUPPLY = toBN(10_000_000).mul(constants.DEFAULT_FACTOR);
    const NON_INFLATION_PERIOD = toBN(3).mul(constants.ONE_YEAR_SECONDS);
    const INIT_UNLOCKED_PERCENT = toBN(1000);
    const ONE_DAY = toBN(86400);
    const THREE_YEARS = toBN(3).mul(constants.ONE_YEAR_SECONDS);

    const [deployer, dao, timeLock, manager, user1, user2, user3] = accounts;
    let gro, groD, groV, groH, groB, staker, lpt1, lpt2, groDV, groIV, groEV;

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
            gro = await GROToken.new("GRO", "GRO", INIT_MAX_TOTAL_SUPPLY, NON_INFLATION_PERIOD);
            groV = await GROVesting.new(constants.ZERO_ADDRESS, timeLock);
            groB = await GROBurner.new(groV.address, gro.address);
            const ts = Math.floor(Date.now() / 1000);
            groEV = await GROEmpVesting.new(ts, toBN(22_509_423).mul(constants.DEFAULT_FACTOR));
            groIV = await GROInvVesting.new(ts, toBN(19_490_577).mul(constants.DEFAULT_FACTOR));
            groDV = await GRODaoVesting.new(
                ts,
                toBN(8_000_000).mul(constants.DEFAULT_FACTOR),
                toBN(45_000_000).mul(constants.DEFAULT_FACTOR),
                dao,
                timeLock
            );
            groD = await GRODistributer.new(
                gro.address,
                [groDV.address, groIV.address, groEV.address, groV.address],
                groB.address
            );

            await gro.setDistributer(groD.address);
            await groV.setDistributer(groD.address);
            await groDV.setDistributer(groD.address, {from: dao});
            await groDV.setCommunityVester(groV.address, {from: dao});
            await groIV.setDistributer(groD.address);
            await groEV.setDistributer(groD.address);
            await groB.setDistributer(groD.address);
            await groB.setVester(groV.address);
            await groV.setVester(groB.address, true);

            groH = await GROHodler.new(groV.address, constants.ZERO_ADDRESS);
            await groH.setMaintainer(manager);
            await groV.setHodlerClaims(groH.address);
            await groH.setClaimDelay(ONE_DAY.mul(toBN(7)));
            await groV.setVester(groH.address, true);

            staker = await LPTokenStaker.new(timeLock);
            await groV.setVester(staker.address, true);
            await staker.setManager(manager);
            await staker.setVesting(groV.address);
            await staker.setMaxGroPerBlock(toBN(100000).mul(constants.DEFAULT_FACTOR));

            await groH.setStatus(false);
            await groV.setStatus(false, {from: timeLock});
            await staker.setStatus(false, {from: timeLock});

            lpt1 = await MockTokenWithOwner.new("LPT1", "LPT1");
            lpt2 = await MockTokenWithOwner.new("LPT2", "LPT2");

            await lpt1.mint(user1, toBN(1_000_000).mul(constants.DEFAULT_FACTOR));
            await lpt2.mint(user1, toBN(1_000_000).mul(constants.DEFAULT_FACTOR));
            await lpt1.approve(staker.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR), {from: user1});
            await lpt2.approve(staker.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR), {from: user1});

            await lpt1.mint(user2, toBN(1_000_000).mul(constants.DEFAULT_FACTOR));
            await lpt2.mint(user2, toBN(1_000_000).mul(constants.DEFAULT_FACTOR));
            await lpt1.approve(staker.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR), {from: user2});
            await lpt2.approve(staker.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR), {from: user2});

            await lpt1.mint(user3, toBN(1_000_000).mul(constants.DEFAULT_FACTOR));
            await lpt2.mint(user3, toBN(1_000_000).mul(constants.DEFAULT_FACTOR));
            await lpt1.approve(staker.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR), {from: user3});
            await lpt2.approve(staker.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR), {from: user3});

            await gro.approve(groB.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR), {from: user1});
            await gro.approve(groB.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR), {from: user2});
            await gro.approve(groB.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR), {from: user3});
        });

        describe("community vesting", function () {
            async function redeployVesting() {
                await groV.setStatus(true, {from: timeLock});

                await expect(groV.vest(true, user1, 1)).to.eventually.be.rejectedWith("vest: paused");
                await expect(groV.extend(1)).to.eventually.be.rejectedWith("extend: paused");
                await expect(groV.exit(1)).to.eventually.be.rejectedWith("exit: paused");

                const newGroVest = await GROVesting.new(groV.address, timeLock);

                let vesters = [groDV.address, groIV.address, groEV.address, newGroVest.address];
                const newGroDist = await GRODistributer.new(gro.address, vesters, groB.address);
                await gro.setDistributer(newGroDist.address);
                await newGroVest.setDistributer(newGroDist.address);
                await groDV.setDistributer(newGroDist.address, {from: dao});
                await groIV.setDistributer(newGroDist.address);
                await groEV.setDistributer(newGroDist.address);
                await groB.setDistributer(newGroDist.address);

                await groDV.setCommunityVester(newGroVest.address, {from: dao});
                await groB.setVester(newGroVest.address);
                await groH.setVester(newGroVest.address);
                await staker.setVesting(newGroVest.address);

                await newGroVest.setVester(groB.address, true);
                await newGroVest.setVester(groH.address, true);
                await newGroVest.setVester(staker.address, true);
                await newGroVest.setHodlerClaims(groH.address);

                await newGroVest.setStatus(false, {from: timeLock});

                return newGroVest;
            }

            it("ok", async () => {
                const ap1 = toBN(2);
                const ap2 = toBN(1);
                const gpb = toBN(90000).mul(constants.DEFAULT_FACTOR);

                await staker.add(ap1, lpt1.address, {from: manager});
                await staker.add(ap2, lpt2.address, {from: manager});

                const amount1 = toBN(2000).mul(constants.DEFAULT_FACTOR);
                await staker.deposit(0, amount1, {from: user1});
                const amount2 = toBN(1000).mul(constants.DEFAULT_FACTOR);
                await staker.deposit(0, amount2, {from: user2});
                const amount3 = toBN(2000).mul(constants.DEFAULT_FACTOR);
                await staker.deposit(0, amount3, {from: user3});

                await staker.setGroPerBlock(gpb, {from: manager});
                await staker.setGroPerBlock(gpb, {from: manager});
                await staker.setGroPerBlock(gpb, {from: manager});

                const instPCT = await groV.instantUnlockPercent();

                // user1 exits partially
                // user2 claims farming
                // user3 claims farming
                // user1 exits partially
                // user2 claims bonus
                // user1 exits
                // user2 claims bonus instantly
                // user3 exits partially
                // user3 claims bonus
                // user1 revests
                // user2 claims farming instantly
                // user1 claims bonus instantly
                // migrates to new one
                // user1 revests
                // user3 claims farming instantly
                // user1 claims bonus
                // user2 claims bonus
                // user3 claims bonus instantly

                await staker.claim(true, 0, {from: user1});
                await staker.claim(true, 0, {from: user2});
                await staker.claim(true, 0, {from: user3});

                const maxPeriod = await groV.maxLockPeriod();

                // user1 exits partially to generate bonus

                let ai = await groV.accountInfos(user1);
                let ua1 = ai.total;
                let us1 = ai.startTime;
                let b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [ai.startTime.add(maxPeriod.div(toBN(2))).toNumber()],
                });
                let eAmount = ua1.div(toBN(3));
                let bonus = await groH.totalBonus();
                let tx = await groV.exit(eAmount, {from: user1});
                // console.log('tx: ' + JSON.stringify(tx));
                let penalty = tx.logs[0].args["penalty"];
                await expect(groH.totalBonus()).to.eventually.be.a.bignumber.equal(bonus.add(penalty));
                ua1 = ua1.sub(eAmount);
                bonus = bonus.add(penalty);

                // user2 claims bonus first time

                ai = await groV.accountInfos(user2);
                let ua2 = ai.total;
                let us2 = ai.startTime;

                ai = await groV.accountInfos(user3);
                let ua3 = ai.total;
                let us3 = ai.startTime;

                b = await web3.eth.getBlock("latest");
                let tv = calcTotalVestingAmount([ua1, ua2, ua3], [us1, us2, us3], toBN(b.timestamp), maxPeriod);
                // console.log('totalVesting: ' + tv);

                let v2 = await groV.vestingBalance(user2);
                // console.log('v2: ' + v2);

                let b2 = await groH.getPendingBonus({from: user2});
                // console.log('b2: ' + b2);

                expect(b2).be.a.bignumber.closeTo(bonus.mul(v2).div(tv), constants.DEFAULT_FACTOR);

                tx = await groH.claim(true, {from: user2});
                b2 = tx.logs[0].args["amount"];
                ai = await groV.accountInfos(user2);
                expect(ai.total).be.a.bignumber.equal(ua2.add(b2));
                ua2 = ai.total;
                us2 = ai.startTime;
                await expect(groH.totalBonus()).to.eventually.be.a.bignumber.equal(bonus.sub(b2));
                bonus = bonus.sub(b2);

                await expect(groH.canClaim({from: user2})).to.eventually.equal(false);

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [
                        toBN(b.timestamp)
                            .add(ONE_DAY.mul(toBN(6)))
                            .toNumber(),
                    ],
                });
                await staker.setGroPerBlock(gpb, {from: manager});

                await expect(groH.canClaim({from: user2})).to.eventually.equal(false);

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [
                        toBN(b.timestamp)
                            .add(ONE_DAY.mul(toBN(2)))
                            .toNumber(),
                    ],
                });
                await staker.setGroPerBlock(gpb, {from: manager});

                await expect(groH.canClaim({from: user2})).to.eventually.equal(true);

                // user1 exits all to generate bonus

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [
                        toBN(b.timestamp)
                            .add(maxPeriod.div(toBN(10)))
                            .toNumber(),
                    ],
                });
                tx = await groV.exit(INIT_MAX_TOTAL_SUPPLY, {from: user1});
                penalty = tx.logs[0].args["penalty"];
                await expect(groH.totalBonus()).to.eventually.be.a.bignumber.equal(bonus.add(penalty));
                ua1 = toBN(0);
                bonus = bonus.add(penalty);

                // user2 claims bonus instantly second time

                b = await web3.eth.getBlock("latest");
                tv = calcTotalVestingAmount([ua2, ua3], [us2, us3], toBN(b.timestamp), maxPeriod);
                // console.log('tv: ' + tv);
                // console.log('groV.totalGroove: ' + await groV.totalGroove());
                v2 = await groV.vestingBalance(user2);
                b2 = await groH.getPendingBonus({from: user2});

                expect(b2).be.a.bignumber.closeTo(bonus.mul(v2).div(tv), constants.DEFAULT_FACTOR);

                let bGro = await gro.balanceOf(user2);
                tx = await groH.claim(false, {from: user2});
                b2 = tx.logs[1].args["amount"];
                let aGro = await gro.balanceOf(user2);
                b2 = b2.mul(instPCT).div(constants.PERCENT_FACTOR);
                expect(aGro.sub(bGro)).to.be.a.bignumber.equal(b2);
                await expect(groH.totalBonus()).to.eventually.be.a.bignumber.equal(bonus.sub(b2));
                bonus = bonus.sub(b2);

                await expect(groH.canClaim({from: user2})).to.eventually.equal(false);

                // user3 exits partially to generate bonus

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [
                        toBN(b.timestamp)
                            .add(maxPeriod.div(toBN(10)))
                            .toNumber(),
                    ],
                });
                eAmount = ua3.div(toBN(4));
                tx = await groV.exit(eAmount, {from: user3});
                // console.log('tx: ' + JSON.stringify(tx));
                penalty = tx.logs[0].args["penalty"];
                await expect(groH.totalBonus()).to.eventually.be.a.bignumber.equal(bonus.add(penalty));
                ua3 = ua3.sub(eAmount);
                bonus = bonus.add(penalty);

                // user3 claims bonus first time

                b = await web3.eth.getBlock("latest");
                tv = calcTotalVestingAmount([ua2, ua3], [us2, us3], toBN(b.timestamp), maxPeriod);
                v3 = await groV.vestingBalance(user3);
                b3 = await groH.getPendingBonus({from: user3});

                expect(b3).be.a.bignumber.closeTo(bonus.mul(v3).div(tv), constants.DEFAULT_FACTOR);

                tx = await groH.claim(true, {from: user3});
                b3 = tx.logs[0].args["amount"];
                console.log("b3: " + b3);
                ai = await groV.accountInfos(user3);
                expect(ai.total).be.a.bignumber.equal(ua3.add(b3));
                ua3 = ai.total;
                us3 = ai.startTime;
                await expect(groH.totalBonus()).to.eventually.be.a.bignumber.equal(bonus.sub(b3));
                bonus = bonus.sub(b3);

                await expect(groH.canClaim({from: user3})).to.eventually.equal(false);

                // user1 revests first time

                let ub1 = await gro.balanceOf(user1);
                ua1 = ub1.div(toBN(3));
                let total = await gro.totalSupply();
                await groB.reVest(ua1, {from: user1});
                await expect(gro.balanceOf(user1)).to.eventually.be.a.bignumber.equal(ub1.sub(ua1));
                await expect(gro.balanceOf(groB.address)).to.eventually.be.a.bignumber.equal(toBN(0));
                await expect(gro.totalSupply()).to.eventually.be.a.bignumber.equal(total.sub(ua1));

                ai = await groV.accountInfos(user1);
                expect(ai.total).be.a.bignumber.equal(ua1);
                b = await web3.eth.getBlock("latest");
                expect(ai.startTime).be.a.bignumber.equal(toBN(b.timestamp));
                us1 = ai.startTime;

                // user2 claims farming instantly

                tx = await staker.claim(false, 0, {from: user2});
                // console.log('tx: ' + JSON.stringify(tx));
                const instantPCT = await groV.instantUnlockPercent();
                let vAmount = tx.logs[1].args["amount"];
                penalty = vAmount.mul(constants.PERCENT_FACTOR.sub(instantPCT)).div(constants.PERCENT_FACTOR);
                await expect(groH.totalBonus()).to.eventually.be.a.bignumber.equal(bonus.add(penalty));
                bonus = bonus.add(penalty);

                // user1 claims bonus instantly first time

                b = await web3.eth.getBlock("latest");
                tv = calcTotalVestingAmount([ua1, ua2, ua3], [us1, us2, us3], toBN(b.timestamp), maxPeriod);
                v1 = await groV.vestingBalance(user1);
                b1 = await groH.getPendingBonus({from: user1});

                expect(b1).be.a.bignumber.closeTo(bonus.mul(v1).div(tv), constants.DEFAULT_FACTOR);

                bGro = await gro.balanceOf(user1);
                tx = await groH.claim(false, {from: user1});
                b1 = tx.logs[1].args["amount"];
                aGro = await gro.balanceOf(user1);
                b1 = b1.mul(instPCT).div(constants.PERCENT_FACTOR);
                expect(aGro.sub(bGro)).to.be.a.bignumber.equal(b1);
                await expect(groH.totalBonus()).to.eventually.be.a.bignumber.equal(bonus.sub(b1));
                bonus = bonus.sub(b1);

                await expect(groH.canClaim({from: user1})).to.eventually.equal(false);

                const newGroV = await redeployVesting();

                // user1 revests second time

                ub1 = await gro.balanceOf(user1);
                total = await gro.totalSupply();
                await groB.reVest(ub1, {from: user1});
                await expect(gro.balanceOf(user1)).to.eventually.be.a.bignumber.equal(toBN(0));
                await expect(gro.balanceOf(groB.address)).to.eventually.be.a.bignumber.equal(toBN(0));
                await expect(gro.totalSupply()).to.eventually.be.a.bignumber.equal(total.sub(ub1));

                ai = await newGroV.accountInfos(user1);
                expect(ai.total).be.a.bignumber.equal(ua1.add(ub1));
                ua1 = ai.total;
                us1 = ai.startTime;

                // user3 claims farming instantly

                tx = await staker.claim(false, 0, {from: user3});
                // console.log('tx: ' + JSON.stringify(tx));
                vAmount = tx.logs[1].args["amount"];
                penalty = vAmount.mul(constants.PERCENT_FACTOR.sub(instantPCT)).div(constants.PERCENT_FACTOR);
                await expect(groH.totalBonus()).to.eventually.be.a.bignumber.equal(bonus.add(penalty));
                bonus = bonus.add(penalty);

                // user1 claims bonus second time

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [
                        toBN(b.timestamp)
                            .add(ONE_DAY.mul(toBN(7)))
                            .toNumber(),
                    ],
                });
                await staker.setGroPerBlock(gpb, {from: manager});

                await expect(groH.canClaim({from: user1})).to.eventually.equal(true);

                b = await web3.eth.getBlock("latest");
                tv = calcTotalVestingAmount([ua1, ua2, ua3], [us1, us2, us3], toBN(b.timestamp), maxPeriod);
                v1 = await newGroV.vestingBalance(user1);
                b1 = await groH.getPendingBonus({from: user1});

                expect(b1).be.a.bignumber.closeTo(bonus.mul(v1).div(tv), constants.DEFAULT_FACTOR);

                tx = await groH.claim(true, {from: user1});
                b1 = tx.logs[0].args["amount"];
                console.log("b1: " + b1);
                ai = await newGroV.accountInfos(user1);
                expect(ai.total).be.a.bignumber.equal(ua1.add(b1));
                ua1 = ai.total;
                us1 = ai.startTime;
                await expect(groH.totalBonus()).to.eventually.be.a.bignumber.equal(bonus.sub(b1));
                bonus = bonus.sub(b1);

                await expect(groH.canClaim({from: user1})).to.eventually.equal(false);

                // user2 claims bonus second time

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [
                        toBN(b.timestamp)
                            .add(ONE_DAY.mul(toBN(7)))
                            .toNumber(),
                    ],
                });
                await staker.setGroPerBlock(gpb, {from: manager});

                await expect(groH.canClaim({from: user2})).to.eventually.equal(true);

                b = await web3.eth.getBlock("latest");
                tv = calcTotalVestingAmount([ua1, ua2, ua3], [us1, us2, us3], toBN(b.timestamp), maxPeriod);
                v2 = await newGroV.vestingBalance(user2);
                b2 = await groH.getPendingBonus({from: user2});

                expect(b2).be.a.bignumber.closeTo(bonus.mul(v2).div(tv), constants.DEFAULT_FACTOR);

                tx = await groH.claim(true, {from: user2});
                b2 = tx.logs[0].args["amount"];
                // console.log('b2: ' + b2);
                ai = await newGroV.accountInfos(user2);
                expect(ai.total).be.a.bignumber.equal(ua2.add(b2));
                ua2 = ai.total;
                us2 = ai.startTime;
                await expect(groH.totalBonus()).to.eventually.be.a.bignumber.equal(bonus.sub(b2));
                bonus = bonus.sub(b2);

                await expect(groH.canClaim({from: user2})).to.eventually.equal(false);

                // user3 claims bonus instantly second time

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [
                        toBN(b.timestamp)
                            .add(ONE_DAY.mul(toBN(7)))
                            .toNumber(),
                    ],
                });
                await staker.setGroPerBlock(gpb, {from: manager});

                await expect(groH.canClaim({from: user3})).to.eventually.equal(true);

                b = await web3.eth.getBlock("latest");
                tv = calcTotalVestingAmount([ua1, ua2, ua3], [us1, us2, us3], toBN(b.timestamp), maxPeriod);
                v3 = await newGroV.vestingBalance(user3);
                b3 = await groH.getPendingBonus({from: user3});

                expect(b3).be.a.bignumber.closeTo(bonus.mul(v3).div(tv), constants.DEFAULT_FACTOR);

                bGro = await gro.balanceOf(user3);
                tx = await groH.claim(false, {from: user3});
                b3 = tx.logs[1].args["amount"];
                aGro = await gro.balanceOf(user3);
                b3 = b3.mul(instPCT).div(constants.PERCENT_FACTOR);
                expect(aGro.sub(bGro)).to.be.a.bignumber.equal(b3);
                await expect(groH.totalBonus()).to.eventually.be.a.bignumber.equal(bonus.sub(b3));
                bonus = bonus.sub(b3);

                await expect(groH.canClaim({from: user3})).to.eventually.equal(false);

                return;
            });
        });

        describe("employee vesting", function () {
            it("ok", async () => {
                // vest user1, user2, user3

                let vesting = toBN(0);

                let b = await web3.eth.getBlock("latest");
                let now = toBN(b.timestamp);
                let ua1 = toBN(10000).mul(constants.DEFAULT_FACTOR);
                await groEV.vest(user1, now.sub(ONE_DAY.mul(toBN(22))), ua1);

                b = await web3.eth.getBlock("latest");
                let ep = await groEV.employeePositions(user1);
                expect(ep.total).be.a.bignumber.equal(ua1);
                expect(ep.startTime).be.a.bignumber.equal(toBN(b.timestamp));
                await expect(groEV.vestingAssets()).to.eventually.be.a.bignumber.equal(vesting.add(ua1));
                vesting = vesting.add(ua1);

                let ua2 = toBN(20000).mul(constants.DEFAULT_FACTOR);
                await groEV.vest(user2, now.sub(ONE_DAY.mul(toBN(15))), ua2);

                b = await web3.eth.getBlock("latest");
                ep = await groEV.employeePositions(user2);
                expect(ep.total).be.a.bignumber.equal(ua2);
                expect(ep.startTime).be.a.bignumber.equal(now.sub(ONE_DAY.mul(toBN(15))));
                await expect(groEV.vestingAssets()).to.eventually.be.a.bignumber.equal(vesting.add(ua2));
                vesting = vesting.add(ua2);

                let ua3 = toBN(30000).mul(constants.DEFAULT_FACTOR);
                await groEV.vest(user3, now.add(ONE_DAY), ua3);

                b = await web3.eth.getBlock("latest");
                ep = await groEV.employeePositions(user3);
                expect(ep.total).be.a.bignumber.equal(ua3);
                expect(ep.startTime).be.a.bignumber.equal(now.add(ONE_DAY));
                await expect(groEV.vestingAssets()).to.eventually.be.a.bignumber.equal(vesting.add(ua3));
                vesting = vesting.add(ua3);

                // Move forward 360 days

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [
                        toBN(b.timestamp)
                            .add(ONE_DAY.mul(toBN(360)))
                            .toNumber(),
                    ],
                });
                await groH.setStatus(false);

                // user1 claims failed because of cliff

                await expect(groEV.claim(100, {from: user1})).to.eventually.be.rejectedWith(
                    "claim: Not enough user assets available"
                );

                // user2 claims failed when over available

                await expect(groEV.claim(ua2, {from: user2})).to.eventually.be.rejectedWith(
                    "claim: Not enough user assets available"
                );

                // user2 claims 1000

                let minting = await groD.mintingPools(groEV.address);

                let amount = toBN(1000).mul(constants.DEFAULT_FACTOR);
                await groEV.claim(amount, {from: user2});
                ep = await groEV.employeePositions(user2);
                expect(ep.withdrawn).be.a.bignumber.equal(amount);
                await expect(gro.balanceOf(user2)).to.eventually.be.a.bignumber.equal(amount);
                await expect(groD.mintingPools(groEV.address)).to.eventually.be.a.bignumber.equal(minting.sub(amount));
                minting = minting.sub(amount);

                // user1 claims half

                b = await web3.eth.getBlock("latest");
                ep = await groEV.employeePositions(user1);
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [ep.startTime.add(THREE_YEARS.div(toBN(2))).toNumber()],
                });
                await groH.setStatus(false);

                amount = ua1.div(toBN(2));
                await groEV.claim(amount, {from: user1});
                ep = await groEV.employeePositions(user1);
                expect(ep.withdrawn).be.a.bignumber.equal(amount);
                await expect(gro.balanceOf(user1)).to.eventually.be.a.bignumber.equal(amount);
                await expect(groD.mintingPools(groEV.address)).to.eventually.be.a.bignumber.equal(minting.sub(amount));
                minting = minting.sub(amount);

                // stop user2 when its locked is left 1/4

                b = await web3.eth.getBlock("latest");
                ep = await groEV.employeePositions(user2);
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [ep.startTime.add(THREE_YEARS.mul(toBN(3)).div(toBN(4))).toNumber()],
                });
                await groEV.stopVesting(user2);

                ep = await groEV.employeePositions(user2);
                expect(ep.total).be.a.bignumber.equal(ua2.mul(toBN(3)).div(toBN(4)));
                b = await web3.eth.getBlock("latest");
                expect(ep.stopTime).be.a.bignumber.equal(toBN(b.timestamp));
                await expect(groEV.vestingAssets()).to.eventually.be.a.bignumber.equal(vesting.sub(ua2.div(toBN(4))));
                vesting = vesting.sub(ua2.div(toBN(4)));

                // Move forward one year

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [
                        toBN(b.timestamp)
                            .add(ONE_DAY.mul(toBN(365)))
                            .toNumber(),
                    ],
                });
                await groH.setStatus(false);

                // user1 claims half

                let vb = await groEV.vestedBalance(user1);
                expect(vb.vested).be.a.bignumber.equal(ua1);
                expect(vb.available).be.a.bignumber.equal(ua1.div(toBN(2)));

                amount = ua1.div(toBN(2));
                await groEV.claim(amount, {from: user1});
                ep = await groEV.employeePositions(user1);
                expect(ep.withdrawn).be.a.bignumber.equal(ua1);
                await expect(gro.balanceOf(user1)).to.eventually.be.a.bignumber.equal(ua1);
                await expect(groD.mintingPools(groEV.address)).to.eventually.be.a.bignumber.equal(minting.sub(amount));
                minting = minting.sub(amount);

                // user3 claims all

                vb = await groEV.vestedBalance(user3);
                expect(vb.vested).be.a.bignumber.equal(ua3);
                expect(vb.available).be.a.bignumber.equal(ua3);

                amount = ua3;
                await groEV.claim(amount, {from: user3});
                ep = await groEV.employeePositions(user3);
                expect(ep.withdrawn).be.a.bignumber.equal(ua3);
                await expect(gro.balanceOf(user3)).to.eventually.be.a.bignumber.equal(ua3);
                await expect(groD.mintingPools(groEV.address)).to.eventually.be.a.bignumber.equal(minting.sub(amount));
                minting = minting.sub(amount);

                // user2 claims 3/4

                ep = await groEV.employeePositions(user2);
                vb = await groEV.vestedBalance(user2);
                expect(vb.vested).be.a.bignumber.equal(ep.total);
                expect(vb.available).be.a.bignumber.equal(ep.total.sub(ep.withdrawn));

                amount = ep.total.sub(ep.withdrawn);
                await groEV.claim(amount, {from: user2});
                ep = await groEV.employeePositions(user2);
                expect(ep.total).be.a.bignumber.equal(ep.withdrawn);
                await expect(gro.balanceOf(user2)).to.eventually.be.a.bignumber.equal(ep.total);
                await expect(groD.mintingPools(groEV.address)).to.eventually.be.a.bignumber.equal(minting.sub(amount));
                minting = minting.sub(amount);

                // owner withdraws user2's 1/4

                amount = ua2.div(toBN(4));
                await groEV.withdraw(amount);
                await expect(gro.balanceOf(deployer)).to.eventually.be.a.bignumber.equal(amount);
                await expect(groEV.vestingAssets()).to.eventually.be.a.bignumber.equal(vesting.add(ua2.div(toBN(4))));
                vesting = vesting.add(ua2.div(toBN(4)));
                await expect(groD.mintingPools(groEV.address)).to.eventually.be.a.bignumber.equal(minting.sub(amount));
                minting = minting.sub(amount);

                // user1 revests

                let cMinting = await groD.mintingPools(groV.address);

                let ub1 = await gro.balanceOf(user1);
                let total = await gro.totalSupply();
                await groB.reVest(ub1, {from: user1});
                await expect(gro.balanceOf(user1)).to.eventually.be.a.bignumber.equal(toBN(0));
                await expect(gro.balanceOf(groB.address)).to.eventually.be.a.bignumber.equal(toBN(0));
                await expect(gro.totalSupply()).to.eventually.be.a.bignumber.equal(total.sub(ub1));

                let ai = await groV.accountInfos(user1);
                expect(ai.total).be.a.bignumber.equal(ub1);

                await expect(groD.mintingPools(groV.address)).to.eventually.be.a.bignumber.equal(cMinting.add(ub1));

                return;
            });
        });

        describe("investor vesting", function () {
            it("ok", async () => {
                // vest user1, user2, user3

                let vesting = toBN(0);

                let b = await web3.eth.getBlock("latest");
                let now = toBN(b.timestamp);
                let ua1 = toBN(10000).mul(constants.DEFAULT_FACTOR);
                await groIV.vest(user1, now.sub(ONE_DAY.mul(toBN(22))), ua1);

                b = await web3.eth.getBlock("latest");
                let ip = await groIV.investorPositions(user1);
                expect(ip.total).be.a.bignumber.equal(ua1);
                expect(ip.startTime).be.a.bignumber.equal(toBN(b.timestamp));
                await expect(groIV.vestingAssets()).to.eventually.be.a.bignumber.equal(vesting.add(ua1));
                vesting = vesting.add(ua1);

                let ua2 = toBN(20000).mul(constants.DEFAULT_FACTOR);
                await groIV.vest(user2, now.sub(ONE_DAY.mul(toBN(15))), ua2);

                b = await web3.eth.getBlock("latest");
                ip = await groIV.investorPositions(user2);
                expect(ip.total).be.a.bignumber.equal(ua2);
                expect(ip.startTime).be.a.bignumber.equal(now.sub(ONE_DAY.mul(toBN(15))));
                await expect(groIV.vestingAssets()).to.eventually.be.a.bignumber.equal(vesting.add(ua2));
                vesting = vesting.add(ua2);

                let ua3 = toBN(30000).mul(constants.DEFAULT_FACTOR);
                await groIV.vest(user3, now.add(ONE_DAY), ua3);

                b = await web3.eth.getBlock("latest");
                ip = await groIV.investorPositions(user3);
                expect(ip.total).be.a.bignumber.equal(ua3);
                expect(ip.startTime).be.a.bignumber.equal(now.add(ONE_DAY));
                await expect(groIV.vestingAssets()).to.eventually.be.a.bignumber.equal(vesting.add(ua3));
                vesting = vesting.add(ua3);

                // Move forward 360 days

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [
                        toBN(b.timestamp)
                            .add(ONE_DAY.mul(toBN(360)))
                            .toNumber(),
                    ],
                });
                await groH.setStatus(false);

                // user1 claims failed because of cliff

                await expect(groIV.claim(100, {from: user1})).to.eventually.be.rejectedWith(
                    "claim: Not enough user assets available"
                );

                // user2 claims failed when over available

                await expect(groIV.claim(ua2, {from: user2})).to.eventually.be.rejectedWith(
                    "claim: Not enough user assets available"
                );

                // user2 claims 1000

                let minting = await groD.mintingPools(groIV.address);

                let amount = toBN(1000).mul(constants.DEFAULT_FACTOR);
                await groIV.claim(amount, {from: user2});
                ip = await groIV.investorPositions(user2);
                expect(ip.withdrawn).be.a.bignumber.equal(amount);
                await expect(gro.balanceOf(user2)).to.eventually.be.a.bignumber.equal(amount);
                await expect(groD.mintingPools(groIV.address)).to.eventually.be.a.bignumber.equal(minting.sub(amount));
                minting = minting.sub(amount);

                // user1 claims half

                b = await web3.eth.getBlock("latest");
                ip = await groIV.investorPositions(user1);
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [ip.startTime.add(THREE_YEARS.div(toBN(2))).toNumber()],
                });
                await groH.setStatus(false);

                amount = ua1.div(toBN(2));
                await groIV.claim(amount, {from: user1});
                ip = await groIV.investorPositions(user1);
                expect(ip.withdrawn).be.a.bignumber.equal(amount);
                await expect(gro.balanceOf(user1)).to.eventually.be.a.bignumber.equal(amount);
                await expect(groD.mintingPools(groIV.address)).to.eventually.be.a.bignumber.equal(minting.sub(amount));
                minting = minting.sub(amount);

                // Move forward two years

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [
                        toBN(b.timestamp)
                            .add(constants.ONE_YEAR_SECONDS.mul(toBN(2)))
                            .toNumber(),
                    ],
                });
                await groH.setStatus(false);

                // user1 claims half

                let vb = await groIV.vestedBalance(user1);
                expect(vb.vested).be.a.bignumber.equal(ua1);
                expect(vb.available).be.a.bignumber.equal(ua1.div(toBN(2)));

                amount = ua1.div(toBN(2));
                await groIV.claim(amount, {from: user1});
                ip = await groIV.investorPositions(user1);
                expect(ip.withdrawn).be.a.bignumber.equal(ua1);
                await expect(gro.balanceOf(user1)).to.eventually.be.a.bignumber.equal(ua1);
                await expect(groD.mintingPools(groIV.address)).to.eventually.be.a.bignumber.equal(minting.sub(amount));
                minting = minting.sub(amount);

                // user3 claims all

                vb = await groIV.vestedBalance(user3);
                expect(vb.vested).be.a.bignumber.equal(ua3);
                expect(vb.available).be.a.bignumber.equal(ua3);

                amount = ua3;
                await groIV.claim(amount, {from: user3});
                ip = await groIV.investorPositions(user3);
                expect(ip.withdrawn).be.a.bignumber.equal(ua3);
                await expect(gro.balanceOf(user3)).to.eventually.be.a.bignumber.equal(ua3);
                await expect(groD.mintingPools(groIV.address)).to.eventually.be.a.bignumber.equal(minting.sub(amount));
                minting = minting.sub(amount);

                // user2 claims all left

                ip = await groIV.investorPositions(user2);
                vb = await groIV.vestedBalance(user2);
                expect(vb.vested).be.a.bignumber.equal(ip.total);
                expect(vb.available).be.a.bignumber.equal(ip.total.sub(ip.withdrawn));

                amount = ip.total.sub(ip.withdrawn);
                await groIV.claim(amount, {from: user2});
                ip = await groIV.investorPositions(user2);
                expect(ip.total).be.a.bignumber.equal(ip.withdrawn);
                await expect(gro.balanceOf(user2)).to.eventually.be.a.bignumber.equal(ip.total);
                await expect(groD.mintingPools(groIV.address)).to.eventually.be.a.bignumber.equal(minting.sub(amount));
                minting = minting.sub(amount);

                // user1 revests
                let cMinting = await groD.mintingPools(groV.address);

                let ub1 = await gro.balanceOf(user1);
                console.log("ub1: " + ub1);
                let total = await gro.totalSupply();
                await groB.reVest(ub1, {from: user1});
                await expect(gro.balanceOf(user1)).to.eventually.be.a.bignumber.equal(toBN(0));
                await expect(gro.balanceOf(groB.address)).to.eventually.be.a.bignumber.equal(toBN(0));
                await expect(gro.totalSupply()).to.eventually.be.a.bignumber.equal(total.sub(ub1));

                let ai = await groV.accountInfos(user1);
                expect(ai.total).be.a.bignumber.equal(ub1);

                await expect(groD.mintingPools(groV.address)).to.eventually.be.a.bignumber.equal(cMinting.add(ub1));

                return;
            });
        });

        describe("dao vesting", function () {
            it("ok", async () => {
                // vest failed because of cooldown

                await expect(groDV.baseVest(user1, 1, {from: dao})).to.eventually.be.rejectedWith(
                    "vest: cannot create a vesting position yet"
                );

                // Move forward 7 days

                let b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [
                        toBN(b.timestamp)
                            .add(ONE_DAY.mul(toBN(7)))
                            .toNumber(),
                    ],
                });
                await groH.setStatus(false);

                let dVesting = toBN(0);
                let cVesting = toBN(0);

                // vest user1, user2, user3

                let ua1 = toBN(10000).mul(constants.DEFAULT_FACTOR);
                await groDV.baseVest(user1, ua1, {from: dao});

                b = await web3.eth.getBlock("latest");
                let dp = await groDV.daoPositions(user1);
                expect(dp.total).be.a.bignumber.equal(ua1);
                expect(dp.startTime).be.a.bignumber.equal(toBN(b.timestamp));
                expect(dp.cliff).be.a.bignumber.equal(toBN(b.timestamp).add(constants.ONE_YEAR_SECONDS));
                expect(dp.endTime).be.a.bignumber.equal(toBN(b.timestamp).add(THREE_YEARS));
                expect(dp.community).equal(false);

                await expect(groDV.vestingAssets()).to.eventually.be.a.bignumber.equal(dVesting.add(ua1));
                dVesting = dVesting.add(ua1);

                let ua2 = toBN(20000).mul(constants.DEFAULT_FACTOR);
                await groDV.customVest(user2, ua2, 0, 0, true, {from: timeLock});

                b = await web3.eth.getBlock("latest");
                dp = await groDV.daoPositions(user2);
                expect(dp.total).be.a.bignumber.equal(ua2);
                expect(dp.startTime).be.a.bignumber.equal(toBN(b.timestamp));
                expect(dp.cliff).be.a.bignumber.equal(toBN(b.timestamp));
                expect(dp.endTime).be.a.bignumber.equal(toBN(b.timestamp));
                expect(dp.community).equal(true);

                await expect(groDV.vestingCommunity()).to.eventually.be.a.bignumber.equal(cVesting.add(ua2));
                cVesting = cVesting.add(ua2);

                let ua3 = toBN(30000).mul(constants.DEFAULT_FACTOR);
                await groDV.customVest(user3, ua3, constants.ONE_YEAR_SECONDS, ONE_DAY.mul(toBN(30)), true, {
                    from: timeLock,
                });

                b = await web3.eth.getBlock("latest");
                dp = await groDV.daoPositions(user3);
                expect(dp.total).be.a.bignumber.equal(ua3);
                expect(dp.startTime).be.a.bignumber.equal(toBN(b.timestamp));
                expect(dp.cliff).be.a.bignumber.equal(toBN(b.timestamp).add(ONE_DAY.mul(toBN(30))));
                expect(dp.endTime).be.a.bignumber.equal(toBN(b.timestamp).add(constants.ONE_YEAR_SECONDS));
                expect(dp.community).equal(true);

                await expect(groDV.vestingCommunity()).to.eventually.be.a.bignumber.equal(cVesting.add(ua3));
                cVesting = cVesting.add(ua3);

                // user2 claims half

                let cMinting = await groD.mintingPools(groV.address);

                let vb = await groDV.vestedBalance(user2);
                expect(vb.vested).be.a.bignumber.equal(ua2);
                expect(vb.available).be.a.bignumber.equal(ua2);

                let amount = ua2.div(toBN(2));
                await groDV.claim(amount, {from: user2});
                dp = await groDV.daoPositions(user2);
                expect(dp.withdrawn).be.a.bignumber.equal(amount);
                await expect(gro.balanceOf(user2)).to.eventually.be.a.bignumber.equal(amount);
                await expect(groD.mintingPools(groV.address)).to.eventually.be.a.bignumber.equal(cMinting.sub(amount));
                cMinting = cMinting.sub(amount);

                // user1 & user3 claims failed because of cliff

                await expect(groDV.claim(100, {from: user1})).to.eventually.be.rejectedWith(
                    "claim: Not enough user assets available"
                );
                await expect(groDV.claim(100, {from: user3})).to.eventually.be.rejectedWith(
                    "claim: Not enough user assets available"
                );

                // Move forward 60 days

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [
                        toBN(b.timestamp)
                            .add(ONE_DAY.mul(toBN(60)))
                            .toNumber(),
                    ],
                });
                await groH.setStatus(false);

                // user1 claims failed because of cliff

                await expect(groDV.claim(100, {from: user1})).to.eventually.be.rejectedWith(
                    "claim: Not enough user assets available"
                );

                // user3 claims 1000

                amount = toBN(1000).mul(constants.DEFAULT_FACTOR);
                await groDV.claim(amount, {from: user3});
                dp = await groDV.daoPositions(user3);
                expect(dp.withdrawn).be.a.bignumber.equal(amount);
                await expect(gro.balanceOf(user3)).to.eventually.be.a.bignumber.equal(amount);

                await expect(groD.mintingPools(groV.address)).to.eventually.be.a.bignumber.equal(cMinting.sub(amount));
                cMinting = cMinting.sub(amount);

                // remove user2 position

                await groDV.removePosition(user2, {from: dao});
                dp = await groDV.daoPositions(user2);
                expect(dp.startTime).be.a.bignumber.equal(toBN(0));

                await expect(groDV.vestingCommunity()).to.eventually.be.a.bignumber.equal(
                    cVesting.sub(ua2.div(toBN(2)))
                );
                cVesting = cVesting.sub(ua2.div(toBN(2)));

                // halt user3 position

                dp = await groDV.daoPositions(user3);
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [dp.startTime.add(dp.endTime.sub(dp.startTime).div(toBN(2))).toNumber()],
                });
                await groDV.haltPosition(user3, {from: dao});

                b = await web3.eth.getBlock("latest");
                dp = await groDV.daoPositions(user3);
                expect(dp.total).be.a.bignumber.equal(ua3.div(toBN(2)));
                expect(dp.endTime).be.a.bignumber.equal(toBN(b.timestamp));

                await expect(groDV.vestingCommunity()).to.eventually.be.a.bignumber.equal(
                    cVesting.sub(ua3.div(toBN(2)))
                );
                cVesting = cVesting.sub(ua3.div(toBN(2)));

                // Move forward 3 years

                b = await web3.eth.getBlock("latest");
                await network.provider.request({
                    method: "evm_setNextBlockTimestamp",
                    params: [
                        toBN(b.timestamp)
                            .add(constants.ONE_YEAR_SECONDS.mul(toBN(3)))
                            .toNumber(),
                    ],
                });
                await groH.setStatus(false);

                // user1 claims all

                let dMinting = await groD.mintingPools(groDV.address);

                vb = await groDV.vestedBalance(user1);
                expect(vb.vested).be.a.bignumber.equal(ua1);
                expect(vb.available).be.a.bignumber.equal(ua1);

                amount = ua1;
                await groDV.claim(amount, {from: user1});
                dp = await groDV.daoPositions(user1);
                expect(dp.withdrawn).be.a.bignumber.equal(ua1);
                await expect(gro.balanceOf(user1)).to.eventually.be.a.bignumber.equal(ua1);

                await expect(groD.mintingPools(groDV.address)).to.eventually.be.a.bignumber.equal(dMinting.sub(amount));
                dMinting = dMinting.sub(amount);

                // user3 claims all left

                dp = await groDV.daoPositions(user3);
                vb = await groDV.vestedBalance(user3);
                expect(vb.vested).be.a.bignumber.equal(dp.total);
                expect(vb.available).be.a.bignumber.equal(dp.total.sub(dp.withdrawn));

                amount = dp.total.sub(dp.withdrawn);
                await groDV.claim(amount, {from: user3});
                dp = await groDV.daoPositions(user3);
                expect(dp.total).be.a.bignumber.equal(dp.withdrawn);
                await expect(gro.balanceOf(user3)).to.eventually.be.a.bignumber.equal(dp.total);

                await expect(groD.mintingPools(groV.address)).to.eventually.be.a.bignumber.equal(cMinting.sub(amount));
                cMinting = cMinting.sub(amount);

                return;
            });
        });
    });

    describe("migrate from v1", function () {
        beforeEach(async function () {
            gro = await GROToken.new("GRO", "GRO", INIT_MAX_TOTAL_SUPPLY, NON_INFLATION_PERIOD);
            groV = await GROVestingV1.new(1000);
            groB = await GROBurnerV1.new(groV.address, gro.address);
            const ts = Math.floor(Date.now() / 1000);
            groEV = await GROEmpVesting.new(ts, toBN(22_509_423).mul(constants.DEFAULT_FACTOR));
            groIV = await GROInvVesting.new(ts, toBN(19_490_577).mul(constants.DEFAULT_FACTOR));
            groDV = await GRODaoVesting.new(
                ts,
                toBN(8_000_000).mul(constants.DEFAULT_FACTOR),
                toBN(45_000_000).mul(constants.DEFAULT_FACTOR),
                dao,
                timeLock
            );
            groD = await GRODistributer.new(
                gro.address,
                [groDV.address, groIV.address, groEV.address, groV.address],
                groB.address
            );

            await gro.setDistributer(groD.address);
            await groV.setDistributer(groD.address);
            await groDV.setDistributer(groD.address, {from: dao});
            await groDV.setCommunityVester(groV.address, {from: dao});
            await groIV.setDistributer(groD.address);
            await groEV.setDistributer(groD.address);
            await groB.setDistributer(groD.address);
            await groB.setVester(groV.address);
            await groV.setVester(groB.address, true);

            groH = await GROHodlerV1.new(groV.address, constants.ZERO_ADDRESS);
            await groH.setMaintainer(manager);
            await groV.setHodlerClaims(groH.address);
            await groH.setStatus(false);
            await groH.setClaimDelay(ONE_DAY.mul(toBN(7)));
            await groV.setVester(groH.address, true);

            staker = await LPTokenStakerV1.new();
            await groV.setVester(staker.address, true);
            await staker.setManager(manager);
            await staker.setVesting(groV.address);
            await staker.setMaxGroPerBlock(toBN(100000).mul(constants.DEFAULT_FACTOR));

            lpt1 = await MockTokenWithOwner.new("LPT1", "LPT1");
            lpt2 = await MockTokenWithOwner.new("LPT2", "LPT2");

            await lpt1.mint(user1, toBN(1_000_000).mul(constants.DEFAULT_FACTOR));
            await lpt2.mint(user1, toBN(1_000_000).mul(constants.DEFAULT_FACTOR));
            await lpt1.approve(staker.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR), {from: user1});
            await lpt2.approve(staker.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR), {from: user1});

            await lpt1.mint(user2, toBN(1_000_000).mul(constants.DEFAULT_FACTOR));
            await lpt2.mint(user2, toBN(1_000_000).mul(constants.DEFAULT_FACTOR));
            await lpt1.approve(staker.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR), {from: user2});
            await lpt2.approve(staker.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR), {from: user2});

            await lpt1.mint(user3, toBN(1_000_000).mul(constants.DEFAULT_FACTOR));
            await lpt2.mint(user3, toBN(1_000_000).mul(constants.DEFAULT_FACTOR));
            await lpt1.approve(staker.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR), {from: user3});
            await lpt2.approve(staker.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR), {from: user3});

            await gro.approve(groB.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR), {from: user1});
            await gro.approve(groB.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR), {from: user2});
            await gro.approve(groB.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR), {from: user3});
        });

        async function redeployVesting() {
            let oldGroPerBlock = await staker.groPerBlock();
            let oldPoolAllocations = [];
            oldPoolAllocations[0] = (await staker.poolInfo(0)).allocPoint;
            oldPoolAllocations[1] = (await staker.poolInfo(1)).allocPoint;

            // disable old staker

            await staker.set(0, 0, {from: manager});
            await staker.set(1, 0, {from: manager});

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

            // disable old burner

            await groB.setVester(constants.ZERO_ADDRESS);
            await groB.setDistributer(constants.ZERO_ADDRESS);
            await expect(groB.reVest(0)).to.eventually.be.rejected;

            // disable old hodler

            await expect(groH.canClaim()).to.eventually.be.equal(true);
            await groH.setStatus(true);
            await expect(groH.canClaim()).to.eventually.be.equal(false);

            // disable old vesting

            await groV.setDistributer(constants.ZERO_ADDRESS);
            await groV.setHodlerClaims(constants.ZERO_ADDRESS);
            await expect(groV.exit({from: user1})).to.eventually.be.rejected;
            await expect(groV.exit({from: user2})).to.eventually.be.rejected;
            await expect(groV.exit({from: user3})).to.eventually.be.rejected;

            const newStaker = await LPTokenStaker.new(timeLock);
            await lpt1.approve(newStaker.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR), {from: user1});
            await lpt2.approve(newStaker.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR), {from: user1});
            await lpt1.approve(newStaker.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR), {from: user2});
            await lpt2.approve(newStaker.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR), {from: user2});
            await newStaker.setOldStaker(staker.address);
            await newStaker.migrateFromV1();
            await expect(newStaker.migrateFromV1()).to.eventually.be.rejectedWith("migrateFromV1: already done");
            await newStaker.setGroPerBlock(oldGroPerBlock, {from: manager});
            await newStaker.set(0, oldPoolAllocations[0], {from: manager});
            await newStaker.set(1, oldPoolAllocations[1], {from: manager});

            const mockLPT1 = await MockTokenWithOwner.new("MockLPT1", "MockLPT1");
            const mockLPT2 = await MockTokenWithOwner.new("MockLPT2", "MockLPT2");
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

            const newGroVest = await GROVesting.new(groV.address, timeLock);
            const newGroH = await GROHodler.new(newGroVest.address, groH.address);
            const newGroB = await GROBurner.new(newGroVest.address, gro.address);

            let vesters = [groDV.address, groIV.address, groEV.address, newGroVest.address];
            const newGroDist = await GRODistributer.new(gro.address, vesters, newGroB.address);
            await gro.setDistributer(newGroDist.address);
            await newGroVest.setDistributer(newGroDist.address);
            await groDV.setDistributer(newGroDist.address, {from: dao});
            await groIV.setDistributer(newGroDist.address);
            await groEV.setDistributer(newGroDist.address);
            await newGroB.setDistributer(newGroDist.address);

            await groDV.setCommunityVester(newGroVest.address, {from: dao});
            await newStaker.setVesting(newGroVest.address);

            await newGroVest.setVester(newGroB.address, true);
            await newGroVest.setVester(newGroH.address, true);
            await newGroVest.setVester(newStaker.address, true);
            await newGroVest.setHodlerClaims(newGroH.address);

            await gro.approve(newGroB.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR), {from: user1});
            await gro.approve(newGroB.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR), {from: user2});
            await gro.approve(newGroB.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR), {from: user3});

            await newGroH.setStatus(false);
            await newGroVest.setStatus(false, {from: timeLock});
            await newStaker.setStatus(false, {from: timeLock});

            return [newGroVest, newStaker, newGroH, newGroB];
        }

        it("ok", async () => {
            const ap1 = toBN(2);
            const ap2 = toBN(1);
            const gpb = toBN(90000).mul(constants.DEFAULT_FACTOR);

            await staker.add(ap1, lpt1.address, {from: manager});
            await staker.add(ap2, lpt2.address, {from: manager});

            const amount1 = toBN(2000).mul(constants.DEFAULT_FACTOR);
            await staker.deposit(0, amount1, {from: user1});
            const amount2 = toBN(1000).mul(constants.DEFAULT_FACTOR);
            await staker.deposit(0, amount2, {from: user2});
            const amount3 = toBN(2000).mul(constants.DEFAULT_FACTOR);
            await staker.deposit(0, amount3, {from: user3});

            await staker.setGroPerBlock(gpb, {from: manager});
            await staker.setGroPerBlock(gpb, {from: manager});
            await staker.setGroPerBlock(gpb, {from: manager});

            // user1 exits
            // user2 claims bonus
            // user2 claims bonus
            // user3 claims bonus
            // user1 revests
            // user1 claims bonus
            // migrates to new one
            // user1 revests
            // user3 claims farming instantly
            // user1 claims bonus instantly
            // user2 claims bonus
            // user3 claims bonus

            await staker.claim(0, {from: user1});
            await staker.claim(0, {from: user2});
            await staker.claim(0, {from: user3});

            const maxPeriod = await groV.maxLockPeriod();

            // user1 exits to generate bonus

            let ai = await groV.accountInfos(user1);
            let ua1 = ai.total;
            let us1 = ai.startTime;
            let b = await web3.eth.getBlock("latest");
            await network.provider.request({
                method: "evm_setNextBlockTimestamp",
                params: [ai.startTime.add(maxPeriod.div(toBN(2))).toNumber()],
            });
            await groV.exit({from: user1});

            // user2 claims bonus first time

            let bonus = await groH.totalBonus();
            // console.log('bonus: ' + bonus);

            ai = await groV.accountInfos(user2);
            let ua2 = ai.total;
            let us2 = ai.startTime;

            ai = await groV.accountInfos(user3);
            let ua3 = ai.total;
            let us3 = ai.startTime;

            b = await web3.eth.getBlock("latest");
            let tv = calcTotalVestingAmount([ua2, ua3], [us2, us3], toBN(b.timestamp), maxPeriod);
            // console.log('totalVesting: ' + tv);

            let v2 = await groV.vestingBalance(user2);
            // console.log('v2: ' + v2);

            let b2 = await groH.getPendingBonus({from: user2});
            // console.log('b2: ' + b2);

            expect(b2).be.a.bignumber.closeTo(bonus.mul(v2).div(tv), constants.DEFAULT_FACTOR);

            let tx = await groH.claim({from: user2});
            b2 = tx.logs[0].args["amount"];
            ai = await groV.accountInfos(user2);
            expect(ai.total).be.a.bignumber.equal(ua2.add(b2));
            ua2 = ai.total;
            us2 = ai.startTime;
            await expect(groH.totalBonus()).to.eventually.be.a.bignumber.equal(bonus.sub(b2));
            bonus = bonus.sub(b2);

            await expect(groH.canClaim({from: user2})).to.eventually.equal(false);

            b = await web3.eth.getBlock("latest");
            await network.provider.request({
                method: "evm_setNextBlockTimestamp",
                params: [
                    toBN(b.timestamp)
                        .add(ONE_DAY.mul(toBN(6)))
                        .toNumber(),
                ],
            });
            await staker.setGroPerBlock(gpb, {from: manager});

            await expect(groH.canClaim({from: user2})).to.eventually.equal(false);

            b = await web3.eth.getBlock("latest");
            await network.provider.request({
                method: "evm_setNextBlockTimestamp",
                params: [
                    toBN(b.timestamp)
                        .add(ONE_DAY.mul(toBN(2)))
                        .toNumber(),
                ],
            });
            await staker.setGroPerBlock(gpb, {from: manager});

            await expect(groH.canClaim({from: user2})).to.eventually.equal(true);

            // user2 claims bonus second time

            b = await web3.eth.getBlock("latest");
            tv = calcTotalVestingAmount([ua2, ua3], [us2, us3], toBN(b.timestamp), maxPeriod);
            // console.log('tv: ' + tv);
            // console.log('groV.totalGroove: ' + await groV.totalGroove());
            v2 = await groV.vestingBalance(user2);
            b2 = await groH.getPendingBonus({from: user2});

            expect(b2).be.a.bignumber.closeTo(bonus.mul(v2).div(tv), constants.DEFAULT_FACTOR);

            tx = await groH.claim({from: user2});
            b2 = tx.logs[0].args["amount"];
            ai = await groV.accountInfos(user2);
            expect(ai.total).be.a.bignumber.equal(ua2.add(b2));
            ua2 = ai.total;
            us2 = ai.startTime;
            await expect(groH.totalBonus()).to.eventually.be.a.bignumber.equal(bonus.sub(b2));
            bonus = bonus.sub(b2);

            await expect(groH.canClaim({from: user2})).to.eventually.equal(false);

            // user3 claims bonus first time

            b = await web3.eth.getBlock("latest");
            tv = calcTotalVestingAmount([ua2, ua3], [us2, us3], toBN(b.timestamp), maxPeriod);
            v3 = await groV.vestingBalance(user3);
            b3 = await groH.getPendingBonus({from: user3});

            expect(b3).be.a.bignumber.closeTo(bonus.mul(v3).div(tv), constants.DEFAULT_FACTOR);

            tx = await groH.claim({from: user3});
            b3 = tx.logs[0].args["amount"];
            console.log("b3: " + b3);
            ai = await groV.accountInfos(user3);
            expect(ai.total).be.a.bignumber.equal(ua3.add(b3));
            ua3 = ai.total;
            us3 = ai.startTime;
            await expect(groH.totalBonus()).to.eventually.be.a.bignumber.equal(bonus.sub(b3));
            bonus = bonus.sub(b3);

            await expect(groH.canClaim({from: user3})).to.eventually.equal(false);

            // user1 revests first time

            let ub1 = await gro.balanceOf(user1);
            ua1 = ub1.div(toBN(3));
            let total = await gro.totalSupply();
            await groB.reVest(ua1, {from: user1});
            await expect(gro.balanceOf(user1)).to.eventually.be.a.bignumber.equal(ub1.sub(ua1));
            await expect(gro.balanceOf(groB.address)).to.eventually.be.a.bignumber.equal(toBN(0));
            await expect(gro.totalSupply()).to.eventually.be.a.bignumber.equal(total.sub(ua1));

            ai = await groV.accountInfos(user1);
            expect(ai.total).be.a.bignumber.equal(ua1);
            b = await web3.eth.getBlock("latest");
            expect(ai.startTime).be.a.bignumber.equal(toBN(b.timestamp));
            us1 = ai.startTime;

            // user1 claims bonus first time

            b = await web3.eth.getBlock("latest");
            tv = calcTotalVestingAmount([ua1, ua2, ua3], [us1, us2, us3], toBN(b.timestamp), maxPeriod);
            v1 = await groV.vestingBalance(user1);
            b1 = await groH.getPendingBonus({from: user1});

            expect(b1).be.a.bignumber.closeTo(bonus.mul(v1).div(tv), constants.DEFAULT_FACTOR);

            tx = await groH.claim({from: user1});
            b1 = tx.logs[0].args["amount"];
            console.log("b1: " + b1);
            ai = await groV.accountInfos(user1);
            expect(ai.total).be.a.bignumber.equal(ua1.add(b1));
            ua1 = ai.total;
            us1 = ai.startTime;
            await expect(groH.totalBonus()).to.eventually.be.a.bignumber.equal(bonus.sub(b1));
            bonus = bonus.sub(b1);

            await expect(groH.canClaim({from: user1})).to.eventually.equal(false);

            const [newGroV, newStaker, newGroH, newGroB] = await redeployVesting();
            const instPCT = await newGroV.instantUnlockPercent();

            // user1 revests second time

            ub1 = await gro.balanceOf(user1);
            total = await gro.totalSupply();
            await newGroB.reVest(ub1, {from: user1});
            await expect(gro.balanceOf(user1)).to.eventually.be.a.bignumber.equal(toBN(0));
            await expect(gro.balanceOf(groB.address)).to.eventually.be.a.bignumber.equal(toBN(0));
            await expect(gro.totalSupply()).to.eventually.be.a.bignumber.equal(total.sub(ub1));

            ai = await newGroV.accountInfos(user1);
            expect(ai.total).be.a.bignumber.equal(ua1.add(ub1));
            ua1 = ai.total;
            us1 = ai.startTime;

            // user3 claims farming instantly

            tx = await newStaker.claim(false, 0, {from: user3});
            // console.log('tx: ' + JSON.stringify(tx));
            vAmount = tx.logs[1].args["amount"];
            const instantPCT = await newGroV.initUnlockedPercent();
            penalty = vAmount.mul(constants.PERCENT_FACTOR.sub(instantPCT)).div(constants.PERCENT_FACTOR);
            await expect(newGroH.totalBonus()).to.eventually.be.a.bignumber.equal(bonus.add(penalty));
            bonus = bonus.add(penalty);

            // user1 claims bonus instantly second time

            b = await web3.eth.getBlock("latest");
            await network.provider.request({
                method: "evm_setNextBlockTimestamp",
                params: [
                    toBN(b.timestamp)
                        .add(ONE_DAY.mul(toBN(7)))
                        .toNumber(),
                ],
            });
            await newStaker.setGroPerBlock(gpb, {from: manager});

            await expect(newGroH.canClaim({from: user1})).to.eventually.equal(true);

            b = await web3.eth.getBlock("latest");
            tv = calcTotalVestingAmount([ua1, ua2, ua3], [us1, us2, us3], toBN(b.timestamp), maxPeriod);
            v1 = await newGroV.vestingBalance(user1);
            b1 = await newGroH.getPendingBonus({from: user1});

            expect(b1).be.a.bignumber.closeTo(bonus.mul(v1).div(tv), constants.DEFAULT_FACTOR);

            let bGro = await gro.balanceOf(user1);
            tx = await newGroH.claim(false, {from: user1});
            b1 = tx.logs[1].args["amount"];
            let aGro = await gro.balanceOf(user1);
            b1 = b1.mul(instPCT).div(constants.PERCENT_FACTOR);
            expect(aGro.sub(bGro)).to.be.a.bignumber.equal(b1);
            await expect(newGroH.totalBonus()).to.eventually.be.a.bignumber.equal(bonus.sub(b1));
            bonus = bonus.sub(b1);

            await expect(newGroH.canClaim({from: user1})).to.eventually.equal(false);

            // user2 claims bonus second time

            b = await web3.eth.getBlock("latest");
            await network.provider.request({
                method: "evm_setNextBlockTimestamp",
                params: [
                    toBN(b.timestamp)
                        .add(ONE_DAY.mul(toBN(7)))
                        .toNumber(),
                ],
            });
            await newStaker.setGroPerBlock(gpb, {from: manager});

            await expect(newGroH.canClaim({from: user2})).to.eventually.equal(true);

            b = await web3.eth.getBlock("latest");
            tv = calcTotalVestingAmount([ua1, ua2, ua3], [us1, us2, us3], toBN(b.timestamp), maxPeriod);
            v2 = await newGroV.vestingBalance(user2);
            b2 = await newGroH.getPendingBonus({from: user2});

            expect(b2).be.a.bignumber.closeTo(bonus.mul(v2).div(tv), constants.DEFAULT_FACTOR);

            tx = await newGroH.claim(true, {from: user2});
            b2 = tx.logs[0].args["amount"];
            // console.log('b2: ' + b2);
            ai = await newGroV.accountInfos(user2);
            expect(ai.total).be.a.bignumber.equal(ua2.add(b2));
            ua2 = ai.total;
            us2 = ai.startTime;
            await expect(newGroH.totalBonus()).to.eventually.be.a.bignumber.equal(bonus.sub(b2));
            bonus = bonus.sub(b2);

            await expect(newGroH.canClaim({from: user2})).to.eventually.equal(false);

            // user3 claims bonus second time

            b = await web3.eth.getBlock("latest");
            await network.provider.request({
                method: "evm_setNextBlockTimestamp",
                params: [
                    toBN(b.timestamp)
                        .add(ONE_DAY.mul(toBN(7)))
                        .toNumber(),
                ],
            });
            await newStaker.setGroPerBlock(gpb, {from: manager});

            await expect(newGroH.canClaim({from: user3})).to.eventually.equal(true);

            b = await web3.eth.getBlock("latest");
            tv = calcTotalVestingAmount([ua1, ua2, ua3], [us1, us2, us3], toBN(b.timestamp), maxPeriod);
            v3 = await newGroV.vestingBalance(user3);
            b3 = await newGroH.getPendingBonus({from: user3});

            expect(b3).be.a.bignumber.closeTo(bonus.mul(v3).div(tv), constants.DEFAULT_FACTOR);

            tx = await newGroH.claim(true, {from: user3});
            b3 = tx.logs[0].args["amount"];
            // console.log('b3: ' + b3);
            ai = await newGroV.accountInfos(user3);
            expect(ai.total).be.a.bignumber.equal(ua3.add(b3));
            ua3 = ai.total;
            us3 = ai.startTime;
            await expect(newGroH.totalBonus()).to.eventually.be.a.bignumber.equal(bonus.sub(b3));
            bonus = bonus.sub(b3);

            await expect(newGroH.canClaim({from: user3})).to.eventually.equal(false);

            return;
        });
    });
});
