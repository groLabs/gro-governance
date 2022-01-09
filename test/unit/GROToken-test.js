
const { toBN } = require('web3-utils');
const GROToken = artifacts.require('GROToken')
const { constants } = require('../utils/constants');
const { expect } = require('../utils/common-utils');

contract('GROToken', function (accounts) {
    const [deployer, noGovernance] = accounts;

    const INIT_MAX_TOTAL_SUPPLY = toBN(10_000_000).mul(constants.DEFAULT_FACTOR);
    const NON_INFLATION_PERIOD = toBN(3).mul(constants.ONE_YEAR_SECONDS);
    let gro;

    async function snapshotChain() {
        return await network.provider.request(
            {
                method: "evm_snapshot",
                params: []
            });
    }

    async function revertChain(snapshotId) {
        await network.provider.request(
            {
                method: "evm_revert",
                params: [snapshotId]
            });
    }

    beforeEach(async function () {
        gro = await GROToken.new('GRO', 'GRO', INIT_MAX_TOTAL_SUPPLY, NON_INFLATION_PERIOD);
    })

    describe('Ownership', function () {
        it('setDistributer revert !Ownership', async () => {
            return expect(gro.setDistributer(constants.ZERO_ADDRESS, { from: noGovernance })).to.eventually.be.rejectedWith('caller is not the owner');
        })

        it('setInflationRate revert !Ownership', async () => {
            return expect(gro.setInflationRate(0, { from: noGovernance })).to.eventually.be.rejectedWith('caller is not the owner');
        })
    })

    describe('setInflationRate', function () {
        it('revert > max inflation rate', async () => {
            const lastMTST = await gro.lastMaxTotalSupplyTime();
            const newTimestamp = lastMTST.add(constants.ONE_YEAR_SECONDS);
            await network.provider.request(
                {
                    method: "evm_setNextBlockTimestamp",
                    params: [newTimestamp.toNumber()]
                });
            return expect(gro.setInflationRate(constants.DEFAULT_FACTOR)).to.eventually.be.rejectedWith('setInflationRate: !rate');
        })

        it('Should default to 0 during non inflation period', async () => {
            return expect(gro.setInflationRate(constants.DEFAULT_FACTOR)).to.eventually.be.rejected;
            return expect(gro.inflationRate()).to.eventually.be.a.bignumber.equal(toBN(0));
        })

        it('revert same rate', async () => {
            const lastMTST = await gro.lastMaxTotalSupplyTime();
            const newTimestamp = lastMTST.add(constants.ONE_YEAR_SECONDS);
            await network.provider.request(
                {
                    method: "evm_setNextBlockTimestamp",
                    params: [newTimestamp.toNumber()]
                });
            await gro.setInflationRate(100);
            return expect(gro.setInflationRate(100)).to.eventually.be.rejectedWith('setInflationRate: same rate');
        })

        it('Should not change inflation rate per second during the non inflation period', async () => {
            const rate = constants.DEFAULT_FACTOR.div(toBN(100));
            const lastMTST = await gro.lastMaxTotalSupplyTime();
            return expect(gro.setInflationRate(constants.DEFAULT_FACTOR)).to.eventually.be.rejected;
            await expect(gro.lastMaxTotalSupply()).to.eventually.be.a.bignumber.equal(toBN(INIT_MAX_TOTAL_SUPPLY));
            await expect(gro.lastMaxTotalSupplyTime()).to.eventually.be.a.bignumber.equal(lastMTST);
            return expect(gro.inflationPerSecond()).to.eventually.be.a.bignumber.equal(toBN(0));
        })

        it('ok during inflation period', async () => {
            const sid = await snapshotChain();

            let rate = constants.DEFAULT_FACTOR.div(toBN(100));
            let inflationPerSecond = await gro.inflationPerSecond();
            const lastMTST = await gro.lastMaxTotalSupplyTime();
            const newTimestamp = lastMTST.add(constants.ONE_YEAR_SECONDS);
            await network.provider.request(
                {
                    method: "evm_setNextBlockTimestamp",
                    params: [newTimestamp.toNumber()]
                });

            rate = rate.mul(toBN(2))
            await gro.setInflationRate(rate);

            await expect(gro.lastMaxTotalSupplyTime()).to.eventually.be.a.bignumber.equal(newTimestamp);
            const newLastMaxTotalSupply = INIT_MAX_TOTAL_SUPPLY.add(constants.ONE_YEAR_SECONDS.mul(inflationPerSecond));
            await expect(gro.lastMaxTotalSupply()).to.eventually.be.a.bignumber.equal(newLastMaxTotalSupply);

            await expect(gro.inflationPerSecond()).to.eventually.be.a.bignumber.equal(
                newLastMaxTotalSupply.mul(rate).div(constants.DEFAULT_FACTOR).div(constants.ONE_YEAR_SECONDS));

            await revertChain(sid);
        })
    })

    describe('Inflation', function () {
        it('Should be possible to stop inflation', async () => {
            const sid = await snapshotChain();

            const lastMTST = await gro.lastMaxTotalSupplyTime();
            const newTimestamp = lastMTST.add(constants.ONE_YEAR_SECONDS);
            await network.provider.request(
                {
                    method: "evm_setNextBlockTimestamp",
                    params: [newTimestamp.toNumber()]
                });

            let rate = constants.DEFAULT_FACTOR.div(toBN(100));
            await gro.setInflationRate(rate);
            let inflationPerSecond = await gro.inflationPerSecond();

            rate = rate.mul(toBN(0))
            await gro.setInflationRate(rate);

            const newLastMaxTotalSupply = await gro.lastMaxTotalSupply()
            const nextYearsTimestamp = newTimestamp.add(constants.ONE_YEAR_SECONDS);

            await network.provider.request(
                {
                    method: "evm_setNextBlockTimestamp",
                    params: [nextYearsTimestamp.toNumber()]
                });

            await expect(gro.maxTotalSupply()).to.eventually.be.a.bignumber.equal(newLastMaxTotalSupply);
            await revertChain(sid);
        })

        it('Should be possible to change to infation rate', async () => {
            const sid = await snapshotChain();

            const lastMTST = await gro.lastMaxTotalSupplyTime();
            const y0MTS = await gro.maxTotalSupply();
            const newTimestamp = lastMTST.add(constants.ONE_YEAR_SECONDS);
            await network.provider.request(
                {
                    method: "evm_setNextBlockTimestamp",
                    params: [newTimestamp.toNumber()]
                });

            let rate = constants.DEFAULT_FACTOR.div(toBN(100));
            await gro.setInflationRate(rate);
            rate = rate.mul(toBN(5))
            await gro.setInflationRate(rate);
            let inflationPerSecond = await gro.inflationPerSecond();

            const y1MTS = await gro.maxTotalSupply();
            const maxSupplyDeltaY1 = y1MTS.sub(y0MTS);
            const nextYearsTimestamp = newTimestamp.add(constants.ONE_YEAR_SECONDS);

            await network.provider.request(
                {
                    method: "evm_setNextBlockTimestamp",
                    params: [nextYearsTimestamp.toNumber()]
                });

            await network.provider.request(
                {
                    method: "evm_mine"
                });
            const y2MTS = await gro.maxTotalSupply();
            const maxSupplyDeltaY2 = y2MTS.sub(y1MTS)
            await expect(maxSupplyDeltaY1).to.be.a.bignumber.lessThan(maxSupplyDeltaY2);
            await revertChain(sid);
        })
    })

    describe('mint', function () {
        it('revert !distributer', async () => {
            return expect(gro.mint(constants.ZERO_ADDRESS, 0)).to.eventually.be.rejectedWith('mint: !distributer');
        })

        it('revert !account', async () => {
            await gro.setDistributer(deployer);
            return expect(gro.mint(constants.ZERO_ADDRESS, 0)).to.eventually.be.rejectedWith('ERC20: mint to the zero address');
        })

        it('revert > cap', async () => {
            await gro.setDistributer(deployer);
            return expect(gro.mint(noGovernance, INIT_MAX_TOTAL_SUPPLY.add(toBN(1)))).to.eventually.be.rejectedWith('mint: > cap');
        })

        it('ok during non inflation period', async () => {
            await gro.setDistributer(deployer);
            await gro.mint(noGovernance, INIT_MAX_TOTAL_SUPPLY);
            await expect(gro.balanceOf(noGovernance)).to.eventually.be.a.bignumber.equal(
                INIT_MAX_TOTAL_SUPPLY);
            return expect(gro.mint(noGovernance, toBN(1))).to.eventually.be.rejectedWith('mint: > cap');
        })

        it('ok during inflation period', async () => {
            const sid = await snapshotChain();
            const lastMTST = await gro.lastMaxTotalSupplyTime();
            const newTimestamp = lastMTST.add(constants.ONE_YEAR_SECONDS);
            await network.provider.request(
                {
                    method: "evm_setNextBlockTimestamp",
                    params: [newTimestamp.toNumber()]
                });
            await gro.setDistributer(deployer);

            const rate = constants.DEFAULT_FACTOR.div(toBN(100));
            await gro.setInflationRate(rate);

            const amount = await gro.maxTotalSupply();
            await gro.mint(noGovernance, amount);
            const inflationPerSecond = await gro.inflationPerSecond();
            await expect(gro.balanceOf(noGovernance)).to.eventually.be.a.bignumber.equal(amount);
            await expect(gro.mint(noGovernance, inflationPerSecond.mul(toBN(60)))).to.eventually.be.rejectedWith('mint: > cap');

            await revertChain(sid);
        })
    })

    describe('burn', function () {
        it('revert !distributer', async () => {
            return expect(gro.burn(constants.ZERO_ADDRESS, 0)).to.eventually.be.rejectedWith('mint: !distributer');
        })

        it('revert !account', async () => {
            await gro.setDistributer(deployer);
            return expect(gro.burn(constants.ZERO_ADDRESS, 0)).to.eventually.be.rejectedWith('ERC20: burn from the zero address');
        })

        it('revert burn amount exceeds balance', async () => {
            await gro.setDistributer(deployer);
            return expect(gro.burn(noGovernance, 100)).to.eventually.be.rejectedWith('ERC20: burn amount exceeds balance');
        })

        it('ok', async () => {
            await gro.setDistributer(deployer);
            const amount = toBN(10000).mul(constants.DEFAULT_FACTOR);
            await gro.mint(noGovernance, amount);
            await gro.mint(deployer, amount);

            await expect(gro.balanceOf(noGovernance)).to.eventually.be.a.bignumber.equal(amount);
            await expect(gro.balanceOf(deployer)).to.eventually.be.a.bignumber.equal(amount);
            await expect(gro.totalSupply()).to.eventually.be.a.bignumber.equal(amount.mul(toBN(2)));

            await gro.burn(deployer, amount.div(toBN(2)));

            await expect(gro.balanceOf(noGovernance)).to.eventually.be.a.bignumber.equal(amount);
            await expect(gro.balanceOf(deployer)).to.eventually.be.a.bignumber.equal(amount.div(toBN(2)));
            await expect(gro.totalSupply()).to.eventually.be.a.bignumber.equal(amount.mul(toBN(3)).div(toBN(2)));

            await gro.burn(deployer, amount.div(toBN(2)));

            await expect(gro.balanceOf(noGovernance)).to.eventually.be.a.bignumber.equal(amount);
            await expect(gro.balanceOf(deployer)).to.eventually.be.a.bignumber.equal(toBN(0));
            await expect(gro.totalSupply()).to.eventually.be.a.bignumber.equal(amount);

            await gro.burn(noGovernance, amount);

            await expect(gro.balanceOf(noGovernance)).to.eventually.be.a.bignumber.equal(toBN(0));
            await expect(gro.balanceOf(deployer)).to.eventually.be.a.bignumber.equal(toBN(0));
            await expect(gro.totalSupply()).to.eventually.be.a.bignumber.equal(toBN(0));

            return;
        })
    })

    describe('maxTotalSupply', function () {
        it('ok during non inflation period', async () => {
            return expect(gro.maxTotalSupply()).to.eventually.be.a.bignumber.equal(
                INIT_MAX_TOTAL_SUPPLY);
        })

        it('ok during inflation period', async () => {
            const sid = await snapshotChain();

            const rate = constants.DEFAULT_FACTOR.div(toBN(100));
            let inflationPerSecond = await gro.inflationPerSecond();
            const lastMTST = await gro.lastMaxTotalSupplyTime();
            const newTimestamp = lastMTST.add(constants.ONE_YEAR_SECONDS);
            await network.provider.request(
                {
                    method: "evm_setNextBlockTimestamp",
                    params: [newTimestamp.toNumber()]
                });
            await gro.setDistributer(constants.ZERO_ADDRESS);

            await expect(gro.maxTotalSupply()).to.eventually.be.a.bignumber.equal(
                INIT_MAX_TOTAL_SUPPLY.add(inflationPerSecond.mul(constants.ONE_YEAR_SECONDS)));

            await revertChain(sid);
        })
    })

    describe('Balancer', function () {
        it('verify token compliance', async () => {
            const res = await gro.transfer.call(noGovernance, 0);
            expect(res).equal(true);
            return;
        })
    })
})
