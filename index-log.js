require('dotenv').config();
const Web3 = require('web3');
const log4js = require('log4js');
const BigNumber = require('bignumber.js');

const abis = require('./abis');
const { mainnet: addresses } = require('./addresses');
const Flashswap = require('./build/contracts/Flashswap.json');

const web3 = new Web3(
    new Web3.providers.WebsocketProvider(process.env.BSC_WSS)
);
const { address: admin } = web3.eth.accounts.wallet.add(process.env.PRIVATE_KEY)

// we need pancakeSwap
const pancakeFactory = new web3.eth.Contract(
    abis.pancakeFactory.pancakeFactory,
    addresses.pancake.factory
);
const pancakeRouter = new web3.eth.Contract(
    abis.pancakeRouter.pancakeRouter,
    addresses.pancake.router
);

// we need bakerySwap
/* const bakeryFactory = new web3.eth.Contract(
    abis.bakeryFactory.bakeryFactory,
    addresses.bakery.factory
);
const bakeryRouter = new web3.eth.Contract(
    abis.bakeryRouter.bakeryRouter,
    addresses.bakery.router
); */

// use ApeSwap instead of bakerySwap
const apeFactory = new web3.eth.Contract(
    abis.apeFactory.apeFactory,
    addresses.ape.factory
);
const apeRouter = new web3.eth.Contract(
    abis.apeRouter.apeRouter,
    addresses.ape.router
);

const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
const fromTokens = ['WBNB'];
const fromToken = [
    '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c' // WBNB
];
const fromTokenDecimals = [18];

// ApeSwap token listing
// https://github.com/ApeSwapFinance/apeswap-token-lists/blob/main/lists/apeswap.json
const toTokens = ['BUSD', 'BTCB', 'CAKE', 'SSS', 'JADE', 'RACA', 'THG', 'CPAN', 'MBOX', 'CHESS'];
const toToken = [
    '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56', // BUSD
    '0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c', // BTCB
    '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82', // CAKE
    '0xc3028fbc1742a16a5d69de1b334cbce28f5d7eb3',// SSS
    '0x7ad7242a99f21aa543f9650a56d141c57e4f6081',// JADE
    '0x12bb890508c125661e03b09ec06e404bc9289040',// RACA
    '0x9fd87aefe02441b123c3c32466cd9db4c578618f',// THG
    '0x04260673729c5f2b9894a467736f3d85f8d34fc8',// CPAN
    '0x3203c9e46ca618c8c1ce5dc67e7e9d75f5da2377',// MBOX
    '0x20de22029ab63cf9a7cf5feb2b737ca1ee4c82a6',// CHESS
    
];
const toTokenDecimals = [18, 18, 18];
const amount = process.env.BNB_AMOUNT;

const init = async () => {
    const networkId = await web3.eth.net.getId();
    const logger = await log4js.getLogger();
    logger.level = 'all';

    const flashswap = new web3.eth.Contract(
        Flashswap.abi,
        Flashswap.networks[networkId].address
    );

    let subscription = web3.eth.subscribe('newBlockHeaders', (error, result) => {
        if (!error) {
            // console.log(result);
            return;
        }
        console.error(error);
    })
    .on("connected", subscriptionId => {
        console.log(`You are connected on ${subscriptionId}`);
    })
    .on('data', async block => {
        console.log('-----------------------------------------------------------------------------------------------------------');
        console.log(`New block received. Block # ${block.number}`);
        console.log(`GasLimit: ${block.gasLimit} and Timestamp: ${block.timestamp}`);

        for (let i = 0; i < fromTokens.length; i++) {
            for (let j = 0; j < toTokens.length; j++) {
                // console.log(`Trading ${toTokens[j]}/${fromTokens[i]} ...`);

                const pairAddress = await pancakeFactory.methods.getPair(fromToken[i], toToken[j]).call();
                // console.log(`pairAddress ${toTokens[j]}/${fromTokens[i]} is ${pairAddress}`);
                const unit0 = await new BigNumber(amount);
                const amount0 = await new BigNumber(unit0).shiftedBy(fromTokenDecimals[i]);
                // console.log(`Input amount of ${fromTokens[i]}: ${unit0.toString()}`);
                logger.info(`Input amount of ${fromTokens[i]}: ${unit0.toString()} for ${toTokens[j]}`);

                // The quote currency needs to be WBNB
                let tokenIn, tokenOut;
                if (fromToken[i] === WBNB) {
                    tokenIn = fromToken[i];
                    tokenOut = toToken[j];
                } else if (toToken[j] === WBNB) {
                    tokenIn = toToken[j];
                    tokenOut = fromToken[i];
                } else {
                    return;
                }

                // The quote currency is not WBNB
                if (typeof tokenIn === 'undefined') {
                    return;
                }

                // call getAmountsOut in PancakeSwap
                const amounts = await pancakeRouter.methods.getAmountsOut(amount0, [tokenIn, tokenOut]).call();
                const unit1 = await new BigNumber(amounts[1]).shiftedBy(-toTokenDecimals[j]);
                const amount1 = await new BigNumber(amounts[1]);

                // call getAmountsOut in ApeSwap
                const amounts2 = await apeRouter.methods.getAmountsOut(amount1, [tokenOut, tokenIn]).call();
                const unit2 = await new BigNumber(amounts2[1]).shiftedBy(-fromTokenDecimals[i]);
                const amount2 = await new BigNumber(amounts2[1]);

                let profit = await new BigNumber(amount2).minus(amount0);
                let unit3  = await new BigNumber(unit2).minus(unit0);
                logger.info(`Profit in ${fromTokens[i]}: ${unit3.toString()}`);

                if (profit > 0) {
                    const tx = flashswap.methods.startArbitrage(
                        tokenIn,
                        tokenOut,
                        0,
                        amount1
                    );

                    /* const [gasPrice, gasCost] = await Promise.all([
                        web3.eth.getGasPrice(),
                        tx.estimateGas({from: admin}),
                    ]); */

                    let gasPrice = 5000000000; // 5Gwei
                    let gasCost  = 510000;

                    const txCost = await web3.utils.toBN(gasCost) * web3.utils.toBN(gasPrice);
                    profit = await new BigNumber(profit).minus(txCost);

                    if (profit > 0) {
                        logger.info(`Arbitrage opportunity found! Expected profit: ${profit}`);
                        const data = tx.encodeABI();
                        const txData = {
                            from: admin,
                            to: flashswap.options.address,
                            data,
                            gas: gasCost,
                            gasPrice: gasPrice,
                        };
                        const receipt = await web3.eth.sendTransaction(txData);
                        console.log(`Transaction hash: ${receipt.transactionHash}`);
                    } else {
                        console.log('Transaction cost did not cover profits');
                    }
                } else {
                    logger.info(`Arbitrage opportunity not found! Expected profit: ${profit}`);
                }
            }
        }
    })
    .on('error', error => {
        console.log(error);
    });
}

init();
