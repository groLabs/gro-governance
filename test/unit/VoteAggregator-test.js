const { toBN } = require('web3-utils');
const VoteAggregator = artifacts.require('VoteAggregator');
const { constants } = require('../utils/constants');
const { expect } = require('../utils/common-utils');

contract('VoteAggregator', function (accounts) {
    const [deployer, gro, mainV, empV, invV, staker, pool1, pool2, pool3] = accounts;
    let agg;

    beforeEach(async function () {
        agg = await VoteAggregator.new(gro, mainV, empV, invV, constants.ZERO_ADDRESS, staker);
    })

    describe('Ownership', function () {
        it('setGroWeight revert', async () => {
            return expect(agg.setGroWeight(0, { from: gro })).to.eventually.be.rejectedWith('caller is not the owner');
        })

        it('setVestingWeight revert', async () => {
            return expect(agg.setVestingWeight(constants.ZERO_ADDRESS, 0, 0, { from: gro })).to.eventually.be.rejectedWith('caller is not the owner');
        })

        it('setLPPool revert', async () => {
            return expect(agg.setLPPool(constants.ZERO_ADDRESS, [], 0, { from: gro })).to.eventually.be.rejectedWith('caller is not the owner');
        })
    })

    describe('UniV2Pool', function () {
        it('addUniV2Pool revert', async () => {
            return expect(agg.addUniV2Pool(constants.ZERO_ADDRESS, [], 0, { from: gro })).to.eventually.be.rejectedWith('caller is not the owner');
        })

        it('addUniV2Pool ok', async () => {
            await agg.addUniV2Pool(pool1, [10000, 7000], 1);
            await agg.addUniV2Pool(pool2, [10000, 5000], 2);
            await agg.addUniV2Pool(pool3, [10000, 3000], 3);

            const pools = await agg.getUniV2Pools();

            await expect(pools.length).equal(3);
            await expect(pools[0]).equal(pool1);
            await expect(pools[1]).equal(pool2);
            await expect(pools[2]).equal(pool3);

            let weights = await agg.getLPWeights(pool1);
            await expect(weights.length).equal(2);
            await expect(weights[0]).to.be.a.bignumber.equal(toBN(10000));
            await expect(weights[1]).to.be.a.bignumber.equal(toBN(7000));

            weights = await agg.getLPWeights(pool2);
            await expect(weights.length).equal(2);
            await expect(weights[0]).to.be.a.bignumber.equal(toBN(10000));
            await expect(weights[1]).to.be.a.bignumber.equal(toBN(5000));

            weights = await agg.getLPWeights(pool3);
            await expect(weights.length).equal(2);
            await expect(weights[0]).to.be.a.bignumber.equal(toBN(10000));
            await expect(weights[1]).to.be.a.bignumber.equal(toBN(3000));

            await expect(agg.groPools(pool1)).to.eventually.be.a.bignumber.equal(toBN(1));
            await expect(agg.groPools(pool2)).to.eventually.be.a.bignumber.equal(toBN(2));
            await expect(agg.groPools(pool3)).to.eventually.be.a.bignumber.equal(toBN(3));

            return
        })

        it('removeUniV2Pool revert', async () => {
            return expect(agg.removeUniV2Pool(constants.ZERO_ADDRESS, { from: gro })).to.eventually.be.rejectedWith('caller is not the owner');
        })

        it('remove 1st one', async () => {
            await agg.addUniV2Pool(pool1, [10000, 7000], 1);
            await agg.addUniV2Pool(pool2, [10000, 5000], 2);
            await agg.addUniV2Pool(pool3, [10000, 5000], 3);

            await agg.removeUniV2Pool(pool1);

            await expect(agg.uniV2Pools(0)).to.eventually.equal(pool2);
            await expect(agg.uniV2Pools(1)).to.eventually.equal(pool3);
            await expect(agg.uniV2Pools(2)).to.eventually.be.rejected;

            await expect(agg.lpWeights(pool1, 0)).to.eventually.be.rejected;
            await expect(agg.lpWeights(pool1, 1)).to.eventually.be.rejected;
            await expect(agg.lpWeights(pool2, 0)).to.eventually.be.a.bignumber.equal(toBN(10000));
            await expect(agg.lpWeights(pool2, 1)).to.eventually.be.a.bignumber.equal(toBN(5000));
            await expect(agg.lpWeights(pool3, 0)).to.eventually.be.a.bignumber.equal(toBN(10000));
            await expect(agg.lpWeights(pool3, 1)).to.eventually.be.a.bignumber.equal(toBN(5000));

            await expect(agg.groPools(pool1)).to.eventually.be.a.bignumber.equal(toBN(0));
            await expect(agg.groPools(pool2)).to.eventually.be.a.bignumber.equal(toBN(2));
            await expect(agg.groPools(pool3)).to.eventually.be.a.bignumber.equal(toBN(3));

            return
        })

        it('remove 2nd one', async () => {
            await agg.addUniV2Pool(pool1, [10000, 7000], 1);
            await agg.addUniV2Pool(pool2, [10000, 5000], 2);
            await agg.addUniV2Pool(pool3, [10000, 5000], 3);

            await agg.removeUniV2Pool(pool2);

            await expect(agg.uniV2Pools(0)).to.eventually.equal(pool1);
            await expect(agg.uniV2Pools(1)).to.eventually.equal(pool3);
            await expect(agg.uniV2Pools(2)).to.eventually.be.rejected;

            await expect(agg.lpWeights(pool2, 0)).to.eventually.be.rejected;
            await expect(agg.lpWeights(pool2, 1)).to.eventually.be.rejected;
            await expect(agg.lpWeights(pool1, 0)).to.eventually.be.a.bignumber.equal(toBN(10000));
            await expect(agg.lpWeights(pool1, 1)).to.eventually.be.a.bignumber.equal(toBN(7000));
            await expect(agg.lpWeights(pool3, 0)).to.eventually.be.a.bignumber.equal(toBN(10000));
            await expect(agg.lpWeights(pool3, 1)).to.eventually.be.a.bignumber.equal(toBN(5000));

            await expect(agg.groPools(pool1)).to.eventually.be.a.bignumber.equal(toBN(1));
            await expect(agg.groPools(pool2)).to.eventually.be.a.bignumber.equal(toBN(0));
            await expect(agg.groPools(pool3)).to.eventually.be.a.bignumber.equal(toBN(3));

            return
        })

        it('remove last one', async () => {
            await agg.addUniV2Pool(pool1, [10000, 7000], 1);
            await agg.addUniV2Pool(pool2, [10000, 5000], 2);
            await agg.addUniV2Pool(pool3, [10000, 5000], 3);

            await agg.removeUniV2Pool(pool3);

            await expect(agg.uniV2Pools(0)).to.eventually.equal(pool1);
            await expect(agg.uniV2Pools(1)).to.eventually.equal(pool2);
            await expect(agg.uniV2Pools(2)).to.eventually.be.rejected;

            await expect(agg.lpWeights(pool3, 0)).to.eventually.be.rejected;
            await expect(agg.lpWeights(pool3, 1)).to.eventually.be.rejected;
            await expect(agg.lpWeights(pool2, 0)).to.eventually.be.a.bignumber.equal(toBN(10000));
            await expect(agg.lpWeights(pool2, 1)).to.eventually.be.a.bignumber.equal(toBN(5000));
            await expect(agg.lpWeights(pool1, 0)).to.eventually.be.a.bignumber.equal(toBN(10000));
            await expect(agg.lpWeights(pool1, 1)).to.eventually.be.a.bignumber.equal(toBN(7000));

            await expect(agg.groPools(pool1)).to.eventually.be.a.bignumber.equal(toBN(1));
            await expect(agg.groPools(pool2)).to.eventually.be.a.bignumber.equal(toBN(2));
            await expect(agg.groPools(pool3)).to.eventually.be.a.bignumber.equal(toBN(0));

            return
        })
    })

    describe('BalV2Pool', function () {
        it('addBalV2Pool revert', async () => {
            return expect(agg.addBalV2Pool(constants.ZERO_ADDRESS, [], 0, { from: gro })).to.eventually.be.rejectedWith('caller is not the owner');
        })

        it('addBalV2Pool ok', async () => {
            await agg.addBalV2Pool(pool1, [10000, 7000], 1);
            await agg.addBalV2Pool(pool2, [10000, 5000], 2);
            await agg.addBalV2Pool(pool3, [10000, 3000], 3);

            const pools = await agg.getBalV2Pools();

            await expect(pools.length).equal(3);
            await expect(pools[0]).equal(pool1);
            await expect(pools[1]).equal(pool2);
            await expect(pools[2]).equal(pool3);

            let weights = await agg.getLPWeights(pool1);
            await expect(weights.length).equal(2);
            await expect(weights[0]).to.be.a.bignumber.equal(toBN(10000));
            await expect(weights[1]).to.be.a.bignumber.equal(toBN(7000));

            weights = await agg.getLPWeights(pool2);
            await expect(weights.length).equal(2);
            await expect(weights[0]).to.be.a.bignumber.equal(toBN(10000));
            await expect(weights[1]).to.be.a.bignumber.equal(toBN(5000));

            weights = await agg.getLPWeights(pool3);
            await expect(weights.length).equal(2);
            await expect(weights[0]).to.be.a.bignumber.equal(toBN(10000));
            await expect(weights[1]).to.be.a.bignumber.equal(toBN(3000));

            await expect(agg.groPools(pool1)).to.eventually.be.a.bignumber.equal(toBN(1));
            await expect(agg.groPools(pool2)).to.eventually.be.a.bignumber.equal(toBN(2));
            await expect(agg.groPools(pool3)).to.eventually.be.a.bignumber.equal(toBN(3));

            return
        })

        it('removeBalV2Pool revert', async () => {
            return expect(agg.removeBalV2Pool(constants.ZERO_ADDRESS, { from: gro })).to.eventually.be.rejectedWith('caller is not the owner');
        })

        it('remove 1st one', async () => {
            await agg.addBalV2Pool(pool1, [10000, 7000], 1);
            await agg.addBalV2Pool(pool2, [10000, 5000], 2);
            await agg.addBalV2Pool(pool3, [10000, 5000], 3);

            await agg.removeBalV2Pool(pool1);

            await expect(agg.balV2Pools(0)).to.eventually.equal(pool2);
            await expect(agg.balV2Pools(1)).to.eventually.equal(pool3);
            await expect(agg.balV2Pools(2)).to.eventually.be.rejected;

            await expect(agg.lpWeights(pool1, 0)).to.eventually.be.rejected;
            await expect(agg.lpWeights(pool1, 1)).to.eventually.be.rejected;
            await expect(agg.lpWeights(pool2, 0)).to.eventually.be.a.bignumber.equal(toBN(10000));
            await expect(agg.lpWeights(pool2, 1)).to.eventually.be.a.bignumber.equal(toBN(5000));
            await expect(agg.lpWeights(pool3, 0)).to.eventually.be.a.bignumber.equal(toBN(10000));
            await expect(agg.lpWeights(pool3, 1)).to.eventually.be.a.bignumber.equal(toBN(5000));

            await expect(agg.groPools(pool1)).to.eventually.be.a.bignumber.equal(toBN(0));
            await expect(agg.groPools(pool2)).to.eventually.be.a.bignumber.equal(toBN(2));
            await expect(agg.groPools(pool3)).to.eventually.be.a.bignumber.equal(toBN(3));

            return
        })

        it('remove 2nd one', async () => {
            await agg.addBalV2Pool(pool1, [10000, 7000], 1);
            await agg.addBalV2Pool(pool2, [10000, 5000], 2);
            await agg.addBalV2Pool(pool3, [10000, 5000], 3);

            await agg.removeBalV2Pool(pool2);

            await expect(agg.balV2Pools(0)).to.eventually.equal(pool1);
            await expect(agg.balV2Pools(1)).to.eventually.equal(pool3);
            await expect(agg.balV2Pools(2)).to.eventually.be.rejected;

            await expect(agg.lpWeights(pool2, 0)).to.eventually.be.rejected;
            await expect(agg.lpWeights(pool2, 1)).to.eventually.be.rejected;
            await expect(agg.lpWeights(pool1, 0)).to.eventually.be.a.bignumber.equal(toBN(10000));
            await expect(agg.lpWeights(pool1, 1)).to.eventually.be.a.bignumber.equal(toBN(7000));
            await expect(agg.lpWeights(pool3, 0)).to.eventually.be.a.bignumber.equal(toBN(10000));
            await expect(agg.lpWeights(pool3, 1)).to.eventually.be.a.bignumber.equal(toBN(5000));

            await expect(agg.groPools(pool1)).to.eventually.be.a.bignumber.equal(toBN(1));
            await expect(agg.groPools(pool2)).to.eventually.be.a.bignumber.equal(toBN(0));
            await expect(agg.groPools(pool3)).to.eventually.be.a.bignumber.equal(toBN(3));

            return
        })

        it('remove last one', async () => {
            await agg.addBalV2Pool(pool1, [10000, 7000], 1);
            await agg.addBalV2Pool(pool2, [10000, 5000], 2);
            await agg.addBalV2Pool(pool3, [10000, 5000], 3);

            await agg.removeBalV2Pool(pool3);

            await expect(agg.balV2Pools(0)).to.eventually.equal(pool1);
            await expect(agg.balV2Pools(1)).to.eventually.equal(pool2);
            await expect(agg.balV2Pools(2)).to.eventually.be.rejected;

            await expect(agg.lpWeights(pool3, 0)).to.eventually.be.rejected;
            await expect(agg.lpWeights(pool3, 1)).to.eventually.be.rejected;
            await expect(agg.lpWeights(pool2, 0)).to.eventually.be.a.bignumber.equal(toBN(10000));
            await expect(agg.lpWeights(pool2, 1)).to.eventually.be.a.bignumber.equal(toBN(5000));
            await expect(agg.lpWeights(pool1, 0)).to.eventually.be.a.bignumber.equal(toBN(10000));
            await expect(agg.lpWeights(pool1, 1)).to.eventually.be.a.bignumber.equal(toBN(7000));

            await expect(agg.groPools(pool1)).to.eventually.be.a.bignumber.equal(toBN(1));
            await expect(agg.groPools(pool2)).to.eventually.be.a.bignumber.equal(toBN(2));
            await expect(agg.groPools(pool3)).to.eventually.be.a.bignumber.equal(toBN(0));

            return
        })
    })

    describe('Vesting weights', function () {
        it('setVestingWeight', async () => {
            await agg.setVestingWeight(mainV, 10000, 7000);
            await agg.setVestingWeight(empV, 10000, 5000);
            await agg.setVestingWeight(invV, 10000, 3000);

            let weights = await agg.getVestingWeights(mainV);
            await expect(weights.length).equal(2);
            await expect(weights[0]).to.be.a.bignumber.equal(toBN(10000));
            await expect(weights[1]).to.be.a.bignumber.equal(toBN(7000));

            weights = await agg.getVestingWeights(empV);
            await expect(weights.length).equal(2);
            await expect(weights[0]).to.be.a.bignumber.equal(toBN(10000));
            await expect(weights[1]).to.be.a.bignumber.equal(toBN(5000));

            weights = await agg.getVestingWeights(invV);
            await expect(weights.length).equal(2);
            await expect(weights[0]).to.be.a.bignumber.equal(toBN(10000));
            await expect(weights[1]).to.be.a.bignumber.equal(toBN(3000));
        })
    })
})