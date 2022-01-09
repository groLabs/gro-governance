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
const MockUniswapPool = artifacts.require("MockUniswapPool");
const MockBalancerPool = artifacts.require("MockBalancerPool");
const VoteAggregator = artifacts.require("VoteAggregator");
const VoteAggregatorV1 = artifacts.require("VoteAggregatorV1");

const {constants} = require("../utils/constants");
const {expect} = require("../utils/common-utils");

contract("Smoke Aggregator tests", function (accounts) {
    const INIT_MAX_TOTAL_SUPPLY = toBN(10_000_000).mul(constants.DEFAULT_FACTOR);
    const NON_INFLATION_PERIOD = toBN(3).mul(constants.ONE_YEAR_SECONDS);
    const INIT_UNLOCKED_PERCENT = toBN(1000);
    const ONE_DAY = toBN(86400);
    const THREE_YEARS = toBN(3).mul(constants.ONE_YEAR_SECONDS);

    const UNILP_GRO_RESERVE = toBN(10000).mul(constants.DEFAULT_FACTOR);
    const BALLP_GRO_RESERVE = toBN(20000).mul(constants.DEFAULT_FACTOR);

    const [deployer, dao, timeLock, manager, dist, user] = accounts;
    let gro, groD, groV, groH, groB, staker, uniLP, balLP, groDV, groIV, groEV, aggregator;

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

            uniLP = await MockUniswapPool.new("UniV2LPT", "UniV2LPT");
            await uniLP.setToken0(gro.address, UNILP_GRO_RESERVE);
            await uniLP.setToken1(uniLP.address, 0);

            balLP = await MockBalancerPool.new("BalLPT", "BalLPT");
            await balLP.setToken0(gro.address, BALLP_GRO_RESERVE);
            await balLP.setToken1(balLP.address, 0);

            await uniLP.approve(staker.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR), {from: user});
            await balLP.approve(staker.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR), {from: user});
            await gro.approve(staker.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR), {from: user});

            await staker.add(1, gro.address, {from: manager});
            await staker.add(1, uniLP.address, {from: manager});
            await staker.add(1, balLP.address, {from: manager});
            await staker.setGroPerBlock(toBN(3).mul(constants.DEFAULT_FACTOR), {from: manager});

            await groV.setVester(deployer, true);

            aggregator = await VoteAggregator.new(
                gro.address,
                groV.address,
                groEV.address,
                groIV.address,
                constants.ZERO_ADDRESS,
                staker.address
            );
            await aggregator.setGroWeight(constants.PERCENT_FACTOR);
            await aggregator.setVestingWeight(
                groV.address,
                constants.PERCENT_FACTOR,
                constants.PERCENT_FACTOR.div(toBN(2))
            );
            await aggregator.setVestingWeight(
                groEV.address,
                constants.PERCENT_FACTOR,
                constants.PERCENT_FACTOR.div(toBN(2))
            );
            await aggregator.setVestingWeight(
                groIV.address,
                constants.PERCENT_FACTOR,
                constants.PERCENT_FACTOR.div(toBN(2))
            );
            await aggregator.addUniV2Pool(uniLP.address, [constants.PERCENT_FACTOR, 0], 1);
            await aggregator.addBalV2Pool(balLP.address, [constants.PERCENT_FACTOR, 0], 2);

            await groH.setStatus(false);
            await groV.setStatus(false, {from: timeLock});
            await staker.setStatus(false, {from: timeLock});
        });

        it("only new staker", async () => {
            await gro.setDistributer(dist);
            const groAmount = toBN(100_000).mul(constants.DEFAULT_FACTOR);
            await gro.mint(user, groAmount, {from: dist});
            await gro.setDistributer(groD.address);

            let amount = await gro.balanceOf(user);
            await staker.deposit(0, amount.div(toBN(2)), {from: user});

            await uniLP.mint(user, toBN(100_000).mul(constants.DEFAULT_FACTOR));
            amount = await uniLP.balanceOf(user);
            await staker.deposit(1, amount, {from: user});

            await balLP.mint(user, toBN(100_000).mul(constants.DEFAULT_FACTOR));
            amount = await balLP.balanceOf(user);
            await staker.deposit(2, amount, {from: user});

            value = await aggregator.balanceOf(user);
            await expect(aggregator.balanceOf(user)).to.eventually.be.a.bignumber.closeTo(
                groAmount.add(UNILP_GRO_RESERVE).add(BALLP_GRO_RESERVE),
                toBN(0)
            );

            await groEV.vest(user, 0, toBN(10000).mul(constants.DEFAULT_FACTOR));
            await groIV.vest(user, 0, toBN(10000).mul(constants.DEFAULT_FACTOR));

            let b = await web3.eth.getBlock("latest");
            await network.provider.request({
                method: "evm_setNextBlockTimestamp",
                params: [
                    toBN(b.timestamp)
                        .add(constants.ONE_YEAR_SECONDS.mul(toBN(4)).div(toBN(3)))
                        .toNumber(),
                ],
            });
            await groV.setVester(deployer, true);

            await groV.vest(true, user, toBN(10000).mul(constants.DEFAULT_FACTOR));
            b = await web3.eth.getBlock("latest");
            await network.provider.request({
                method: "evm_setNextBlockTimestamp",
                params: [
                    toBN(b.timestamp)
                        .add(constants.ONE_YEAR_SECONDS.div(toBN(5)))
                        .toNumber(),
                ],
            });
            await groV.setVester(deployer, true);

            let total = await groV.totalBalance(user);
            total = total.add(await groEV.totalBalance(user));
            total = total.add(await groIV.totalBalance(user));

            let unlocked = await groV.vestedBalance(user);
            let result = await groEV.vestedBalance(user);
            unlocked = unlocked.add(result.vested);
            result = await groIV.vestedBalance(user);
            unlocked = unlocked.add(result.vested);
            let locked = total.sub(unlocked);

            value = await aggregator.balanceOf(user);
            let calcValue = groAmount
                .add(UNILP_GRO_RESERVE)
                .add(BALLP_GRO_RESERVE)
                .add(locked)
                .add(unlocked.div(toBN(2)));
            await expect(aggregator.balanceOf(user)).to.eventually.be.a.bignumber.closeTo(calcValue, toBN(0));
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

            staker = await LPTokenStakerV1.new(timeLock);
            await groV.setVester(staker.address, true);
            await staker.setManager(manager);
            await staker.setVesting(groV.address);
            await staker.setMaxGroPerBlock(toBN(100000).mul(constants.DEFAULT_FACTOR));

            uniLP = await MockUniswapPool.new("UniV2LPT", "UniV2LPT");
            await uniLP.setToken0(gro.address, UNILP_GRO_RESERVE);
            await uniLP.setToken1(uniLP.address, 0);

            balLP = await MockBalancerPool.new("BalLPT", "BalLPT");
            await balLP.setToken0(gro.address, BALLP_GRO_RESERVE);
            await balLP.setToken1(balLP.address, 0);

            await uniLP.approve(staker.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR), {from: user});
            await balLP.approve(staker.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR), {from: user});
            await gro.approve(staker.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR), {from: user});

            await staker.add(1, gro.address, {from: manager});
            await staker.add(1, uniLP.address, {from: manager});
            await staker.add(1, balLP.address, {from: manager});
            await staker.setGroPerBlock(toBN(3).mul(constants.DEFAULT_FACTOR), {from: manager});

            await groV.setVester(deployer, true);

            aggregator = await VoteAggregatorV1.new(
                gro.address,
                groV.address,
                groEV.address,
                groIV.address,
                staker.address
            );
            await aggregator.setGroWeight(constants.PERCENT_FACTOR);
            await aggregator.setVestingWeight(
                groV.address,
                constants.PERCENT_FACTOR,
                constants.PERCENT_FACTOR.div(toBN(2))
            );
            await aggregator.setVestingWeight(
                groEV.address,
                constants.PERCENT_FACTOR,
                constants.PERCENT_FACTOR.div(toBN(2))
            );
            await aggregator.setVestingWeight(
                groIV.address,
                constants.PERCENT_FACTOR,
                constants.PERCENT_FACTOR.div(toBN(2))
            );
            await aggregator.addUniV2Pool(uniLP.address, [constants.PERCENT_FACTOR, 0], 1);
            await aggregator.addBalV2Pool(balLP.address, [constants.PERCENT_FACTOR, 0], 2);
        });

        async function redeployVesting() {
            let oldGroPerBlock = await staker.groPerBlock();
            let oldPoolAllocations = [];
            oldPoolAllocations[0] = (await staker.poolInfo(0)).allocPoint;
            oldPoolAllocations[1] = (await staker.poolInfo(1)).allocPoint;
            oldPoolAllocations[2] = (await staker.poolInfo(2)).allocPoint;

            // disable old staker

            await staker.set(0, 0, {from: manager});
            await staker.set(1, 0, {from: manager});
            await staker.set(2, 0, {from: manager});

            // disable old burner

            await groB.setVester(constants.ZERO_ADDRESS);
            await groB.setDistributer(constants.ZERO_ADDRESS);

            // disable old hodler

            await groH.setStatus(true);

            // disable old vesting

            await groV.setDistributer(constants.ZERO_ADDRESS);
            await groV.setHodlerClaims(constants.ZERO_ADDRESS);

            const newStaker = await LPTokenStaker.new(timeLock);
            await gro.approve(newStaker.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR), {from: user});
            await uniLP.approve(newStaker.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR), {from: user});
            await balLP.approve(newStaker.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR), {from: user});
            await newStaker.setOldStaker(staker.address);
            await newStaker.migrateFromV1();
            await expect(newStaker.migrateFromV1()).to.eventually.be.rejectedWith("migrateFromV1: already done");
            await newStaker.setGroPerBlock(oldGroPerBlock, {from: manager});
            await newStaker.set(0, oldPoolAllocations[0], {from: manager});
            await newStaker.set(1, oldPoolAllocations[1], {from: manager});
            await newStaker.set(2, oldPoolAllocations[2], {from: manager});

            const mockLPT0 = await MockTokenWithOwner.new("MockLPT0", "MockLPT0");
            const mockLPT1 = await MockTokenWithOwner.new("MockLPT1", "MockLPT1");
            const mockLPT2 = await MockTokenWithOwner.new("MockLPT2", "MockLPT2");
            const migrator = await MockMigrator.new(
                staker.address,
                newStaker.address,
                [gro.address, uniLP.address, balLP.address],
                [mockLPT0.address, mockLPT1.address, mockLPT2.address]
            );
            await staker.setMigrator(migrator.address);
            await mockLPT0.mint(migrator.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR));
            await mockLPT1.mint(migrator.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR));
            await mockLPT2.mint(migrator.address, toBN(1_000_000).mul(constants.DEFAULT_FACTOR));

            await staker.migrate(0);
            await staker.migrate(1);
            await staker.migrate(2);

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

            await newGroH.setStatus(false);
            await newGroVest.setStatus(false, {from: timeLock});
            await newStaker.setStatus(false, {from: timeLock});

            return [newGroVest, newStaker];
        }

        it("both new staker and old staker", async () => {
            const groAmount = toBN(100_000).mul(constants.DEFAULT_FACTOR);
            await gro.setDistributer(dist);
            await gro.mint(user, groAmount, {from: dist});
            await gro.setDistributer(groD.address);

            let amount = await gro.balanceOf(user);
            await staker.deposit(0, amount.div(toBN(2)), {from: user});

            await uniLP.mint(user, toBN(100_000).mul(constants.DEFAULT_FACTOR));
            amount = await uniLP.balanceOf(user);
            await staker.deposit(1, amount, {from: user});

            await balLP.mint(user, toBN(100_000).mul(constants.DEFAULT_FACTOR));
            amount = await balLP.balanceOf(user);
            await staker.deposit(2, amount, {from: user});

            let value = await aggregator.balanceOf(user);
            await expect(aggregator.balanceOf(user)).to.eventually.be.a.bignumber.closeTo(
                groAmount.add(UNILP_GRO_RESERVE).add(BALLP_GRO_RESERVE),
                toBN(0)
            );
            let oldValue = value;

            const [newGroV, newStaker] = await redeployVesting();

            const newAggregator = await VoteAggregator.new(
                gro.address,
                newGroV.address,
                groEV.address,
                groIV.address,
                staker.address,
                newStaker.address
            );
            await newAggregator.setGroWeight(constants.PERCENT_FACTOR);
            await newAggregator.setVestingWeight(
                newGroV.address,
                constants.PERCENT_FACTOR,
                constants.PERCENT_FACTOR.div(toBN(2))
            );
            await newAggregator.setVestingWeight(
                groEV.address,
                constants.PERCENT_FACTOR,
                constants.PERCENT_FACTOR.div(toBN(2))
            );
            await newAggregator.setVestingWeight(
                groIV.address,
                constants.PERCENT_FACTOR,
                constants.PERCENT_FACTOR.div(toBN(2))
            );
            await newAggregator.addUniV2Pool(uniLP.address, [constants.PERCENT_FACTOR, 0], 1);
            await newAggregator.addBalV2Pool(balLP.address, [constants.PERCENT_FACTOR, 0], 2);

            await expect(newAggregator.balanceOf(user)).to.eventually.be.a.bignumber.closeTo(oldValue, toBN(0));

            amount = await gro.balanceOf(user);
            await newStaker.deposit(0, amount.div(toBN(2)), {from: user});

            await uniLP.mint(user, toBN(50_000).mul(constants.DEFAULT_FACTOR));
            amount = await uniLP.balanceOf(user);
            await newStaker.deposit(1, amount, {from: user});

            await balLP.mint(user, toBN(50_000).mul(constants.DEFAULT_FACTOR));
            amount = await balLP.balanceOf(user);
            await newStaker.deposit(2, amount, {from: user});

            await expect(newAggregator.balanceOf(user)).to.eventually.be.a.bignumber.closeTo(oldValue, toBN(0));

            await groEV.vest(user, 0, toBN(10000).mul(constants.DEFAULT_FACTOR));
            await groIV.vest(user, 0, toBN(10000).mul(constants.DEFAULT_FACTOR));

            let b = await web3.eth.getBlock("latest");
            await network.provider.request({
                method: "evm_setNextBlockTimestamp",
                params: [
                    toBN(b.timestamp)
                        .add(constants.ONE_YEAR_SECONDS.mul(toBN(4)).div(toBN(3)))
                        .toNumber(),
                ],
            });
            await newGroV.setVester(deployer, true);

            await newGroV.vest(true, user, toBN(10000).mul(constants.DEFAULT_FACTOR));
            b = await web3.eth.getBlock("latest");
            await network.provider.request({
                method: "evm_setNextBlockTimestamp",
                params: [
                    toBN(b.timestamp)
                        .add(constants.ONE_YEAR_SECONDS.div(toBN(5)))
                        .toNumber(),
                ],
            });
            await newGroV.setVester(deployer, true);

            let total = await newGroV.totalBalance(user);
            total = total.add(await groEV.totalBalance(user));
            total = total.add(await groIV.totalBalance(user));

            let unlocked = await newGroV.vestedBalance(user);
            let result = await groEV.vestedBalance(user);
            unlocked = unlocked.add(result.vested);
            result = await groIV.vestedBalance(user);
            unlocked = unlocked.add(result.vested);
            let locked = total.sub(unlocked);

            value = await newAggregator.balanceOf(user);
            let calcValue = groAmount
                .add(UNILP_GRO_RESERVE)
                .add(BALLP_GRO_RESERVE)
                .add(locked)
                .add(unlocked.div(toBN(2)));
            await expect(newAggregator.balanceOf(user)).to.eventually.be.a.bignumber.closeTo(calcValue, toBN(0));
        });
    });
});
