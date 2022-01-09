const {toBN, toHex} = require("web3-utils");
const GROToken = artifacts.require("GROToken");
const GRODistributer = artifacts.require("GRODistributer");
const GROVesting = artifacts.require("GROVesting");
const MockBonus = artifacts.require("MockBonus");
const AirDrop = artifacts.require("AirDrop");
const {constants} = require("../utils/constants");
const {expect} = require("../utils/common-utils");

const MerKleTree = (nodes) => {
    function combinedHash(a, b) {
        if (!a) {
            return b;
        }
        if (!b) {
            return a;
        }
        if (a.localeCompare(b) < 0) {
            return web3.utils.soliditySha3({t: "bytes32", v: a}, {t: "bytes32", v: b});
        } else {
            return web3.utils.soliditySha3({t: "bytes32", v: b}, {t: "bytes32", v: a});
        }
    }

    function getNextLayer(elements) {
        const pairs = elements.reduce((result, e, i) => {
            if (i % 2 == 0) {
                result.push([]);
            }
            result.slice(-1)[0].push(e);
            return result;
        }, []);
        return pairs.map((p) => {
            return combinedHash(p[0], p[1]);
        });
    }

    function getLayers(elements) {
        const layers = [elements];
        while (layers.slice(-1)[0].length > 1) {
            layers.push(getNextLayer(layers.slice(-1)[0]));
        }
        return layers;
    }

    const items = nodes.sort((a, b) => {
        return a.localeCompare(b);
    });

    const tree = {
        elements: items,
        layers: getLayers(items),
        root: function () {
            return this.layers.slice(-1)[0];
        },
        getProof: function (e) {
            let i = this.elements.indexOf(e);
            return this.layers.reduce((result, l) => {
                let pi = i % 2 == 0 ? i + 1 : i - 1;
                i = Math.floor(i / 2);
                if (pi < l.length) {
                    result.push(l[pi]);
                }
                return result;
            }, []);
        },
    };

    return tree;
};

contract("Smoke Airdrop tests", function (accounts) {
    const INIT_MAX_TOTAL_SUPPLY = toBN(10_000_000).mul(constants.DEFAULT_FACTOR);
    const NON_INFLATION_PERIOD = toBN(3).mul(constants.ONE_YEAR_SECONDS);
    const INIT_UNLOCKED_PERCENT = toBN(1000);
    const INSTANT_UNLOCKED_PERCENT = toBN(3000);

    const [deployer, groDeployer, dao, user1, user2, user3, vester1, vester2, vester3, burner, timeLock] = accounts;
    let gro, groDist, groVest, airDrop, groHodler;

    beforeEach(async function () {
        gro = await GROToken.new("GRO", "GRO", INIT_MAX_TOTAL_SUPPLY, NON_INFLATION_PERIOD, {from: groDeployer});
        groVest = await GROVesting.new(constants.ZERO_ADDRESS, timeLock);
        vesters = [vester1, vester2, vester3, groVest.address];
        groDist = await GRODistributer.new(gro.address, vesters, burner);
        await gro.setDistributer(groDist.address, {from: groDeployer});
        await groVest.setDistributer(groDist.address);
        await groVest.setInitUnlockedPercent(INIT_UNLOCKED_PERCENT);

        airDrop = await AirDrop.new();

        await groVest.setVester(airDrop.address, true);
        await airDrop.setVesting(groVest.address);
        groBonus = await MockBonus.new();
        await groVest.setHodlerClaims(groBonus.address);

        await groVest.setStatus(false, {from: timeLock});
    });

    describe("ok", function () {
        it("claim & exit", async () => {
            // first airdrop

            const amount11 = toBN(100).mul(constants.DEFAULT_FACTOR);
            const amount21 = toBN(200).mul(constants.DEFAULT_FACTOR);
            const amount31 = toBN(300).mul(constants.DEFAULT_FACTOR);

            let items = [
                {address: user1, amount: amount11},
                {address: user2, amount: amount21},
                {address: user3, amount: amount31},
            ];
            let nodes = items.map((n, i) => {
                const node = web3.utils.soliditySha3({t: "address", v: n.address}, {t: "uint128", v: toHex(n.amount)});
                items[i].node = node;
                return node;
            });
            let tree = MerKleTree(nodes);
            let root = tree.root()[0];
            // console.log('tree root: ', root);

            await airDrop.newDrop(root, amount11.add(amount21).add(amount31), false);

            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                const user = item.address;
                const amount = item.amount;
                console.log("proof " + JSON.stringify(tree.getProof(item.node)));
                await expect(
                    airDrop.verifyDrop(0, amount, tree.getProof(item.node), {from: user})
                ).to.eventually.be.equal(true);
                await airDrop.claim(true, 0, amount, tree.getProof(item.node), {from: user});
                await expect(groVest.totalBalance(user)).to.eventually.be.a.bignumber.equal(amount);
                await expect(
                    airDrop.verifyDrop(0, amount, tree.getProof(item.node), {from: user})
                ).to.eventually.be.rejectedWith("verifyDrop: Drop already claimed");
                await expect(
                    airDrop.claim(true, 0, amount, tree.getProof(item.node), {from: user})
                ).to.eventually.be.rejectedWith("claim: Drop already claimed");
            }

            const initUnlockedPercent = await groVest.initUnlockedPercent();
            const maxPeriod = await groVest.maxLockPeriod();
            let ui = await groVest.accountInfos(user1);
            let b = await web3.eth.getBlock("latest");
            let addedPeriod = maxPeriod.div(toBN(10));
            await network.provider.request({
                method: "evm_setNextBlockTimestamp",
                params: [toBN(ui.startTime).add(addedPeriod).toNumber()],
            });
            await groVest.exit(INIT_MAX_TOTAL_SUPPLY, {from: user1});
            let amount = amount11;
            let initUnlocked = amount.mul(initUnlockedPercent).div(constants.PERCENT_FACTOR);
            let unlocked = amount.sub(initUnlocked).mul(addedPeriod).div(maxPeriod).add(initUnlocked);
            // console.log('user1 unlocked: ' + unlocked);
            // console.log('user1 balanceOf: ' + await gro.balanceOf(user1));
            await expect(gro.balanceOf(user1)).to.eventually.be.a.bignumber.equal(unlocked);

            ui = await groVest.accountInfos(user2);
            b = await web3.eth.getBlock("latest");
            addedPeriod = maxPeriod.div(toBN(5));
            await network.provider.request({
                method: "evm_setNextBlockTimestamp",
                params: [toBN(ui.startTime).add(addedPeriod).toNumber()],
            });
            await groVest.exit(INIT_MAX_TOTAL_SUPPLY, {from: user2});
            amount = amount21;
            initUnlocked = amount21.mul(initUnlockedPercent).div(constants.PERCENT_FACTOR);
            unlocked = amount21.sub(initUnlocked).mul(addedPeriod).div(maxPeriod).add(initUnlocked);
            // console.log('user2 unlocked: ' + unlocked);
            // console.log('user2 balanceOf: ' + await gro.balanceOf(user2));
            await expect(gro.balanceOf(user2)).to.eventually.be.a.bignumber.equal(unlocked);

            // second airdrop

            const amount12 = toBN(200).mul(constants.DEFAULT_FACTOR);
            const amount22 = toBN(300).mul(constants.DEFAULT_FACTOR);
            const amount32 = toBN(400).mul(constants.DEFAULT_FACTOR);

            items = [
                {address: user1, amount: amount12},
                {address: user2, amount: amount22},
                {address: user3, amount: amount32},
            ];
            nodes = items.map((n, i) => {
                const node = web3.utils.soliditySha3({t: "address", v: n.address}, {t: "uint128", v: toHex(n.amount)});
                items[i].node = node;
                return node;
            });
            tree = MerKleTree(nodes);
            root = tree.root()[0];

            await airDrop.newDrop(root, amount12.add(amount22).add(amount32), false);

            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                const user = item.address;
                const amount = item.amount;
                await expect(
                    airDrop.verifyDrop(1, amount, tree.getProof(item.node), {from: user})
                ).to.eventually.be.equal(true);
                let beforeGRO = await gro.balanceOf(user);
                await airDrop.claim(false, 1, amount, tree.getProof(item.node), {from: user});
                let afterGRO = await gro.balanceOf(user);
                expect(afterGRO.sub(beforeGRO)).to.be.a.bignumber.equal(
                    amount.mul(INSTANT_UNLOCKED_PERCENT).div(constants.PERCENT_FACTOR)
                );
                await expect(
                    airDrop.verifyDrop(1, amount, tree.getProof(item.node), {from: user})
                ).to.eventually.be.rejectedWith("verifyDrop: Drop already claimed");
                await expect(
                    airDrop.claim(false, 1, amount, tree.getProof(item.node), {from: user})
                ).to.eventually.be.rejectedWith("claim: Drop already claimed");
            }

            ui = await groVest.accountInfos(user3);
            amount = amount31;
            expect(ui.total).be.a.bignumber.equal(amount);
            b = await web3.eth.getBlock("latest");
            addedPeriod = maxPeriod.div(toBN(2));
            await network.provider.request({
                method: "evm_setNextBlockTimestamp",
                params: [toBN(ui.startTime).add(addedPeriod).toNumber()],
            });
            let beforeBO = await gro.balanceOf(user3);
            await groVest.exit(INIT_MAX_TOTAL_SUPPLY, {from: user3});
            initUnlocked = amount.mul(initUnlockedPercent).div(constants.PERCENT_FACTOR);
            unlocked = amount.sub(initUnlocked).mul(addedPeriod).div(maxPeriod).add(initUnlocked);
            await expect(gro.balanceOf(user3)).to.eventually.be.a.bignumber.equal(unlocked.add(beforeBO));

            // third airdrop

            const amount13 = toBN(300).mul(constants.DEFAULT_FACTOR);
            const amount23 = toBN(400).mul(constants.DEFAULT_FACTOR);
            const amount33 = toBN(500).mul(constants.DEFAULT_FACTOR);

            items = [
                {address: user1, amount: amount13},
                {address: user2, amount: amount23},
                {address: user3, amount: amount33},
            ];
            nodes = items.map((n, i) => {
                const node = web3.utils.soliditySha3({t: "address", v: n.address}, {t: "uint128", v: toHex(n.amount)});
                items[i].node = node;
                return node;
            });
            tree = MerKleTree(nodes);
            root = tree.root()[0];

            await airDrop.newDrop(root, amount13.add(amount23).add(amount33), true);

            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                const user = item.address;
                const amount = item.amount;
                await expect(
                    airDrop.verifyDrop(2, amount, tree.getProof(item.node), {from: user})
                ).to.eventually.be.equal(true);
                let beforeGRO = await gro.balanceOf(user);
                ui = await groVest.accountInfos(user);
                let beforeVestingTotal = ui.total;
                await airDrop.claim(false, 2, amount, tree.getProof(item.node), {from: user});
                let afterGRO = await gro.balanceOf(user);
                ui = await groVest.accountInfos(user);
                let afterVestingTotal = ui.total;
                expect(afterGRO.sub(beforeGRO)).to.be.a.bignumber.equal(toBN(0));
                expect(afterVestingTotal.sub(beforeVestingTotal)).to.be.a.bignumber.equal(amount);
                await expect(
                    airDrop.verifyDrop(2, amount, tree.getProof(item.node), {from: user})
                ).to.eventually.be.rejectedWith("verifyDrop: Drop already claimed");
                await expect(
                    airDrop.claim(false, 2, amount, tree.getProof(item.node), {from: user})
                ).to.eventually.be.rejectedWith("claim: Drop already claimed");
            }

            return;
        });
    });
});
