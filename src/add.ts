import commandLineArgs from 'command-line-args'
import axios from 'axios'
import Web3 from 'web3';
import {MultipleWinnersAbi} from './abi';
import {AbiInput, AbiItem} from 'web3-utils';
import {AppPot, ConfigNft, NftAddedEvent} from './types';
import {loadConfig, saveConfig} from './common';
import {numericSort} from './helpers';

const options = commandLineArgs([
    {name: 'id', alias: 'i', type: String},
]);

const OwnershipTransferredEventTopic = '0x8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0';
// ExternalErc1155AwardAdded (index_topic_1 address externalErc1155, uint256[] tokenIds)
const ExternalErc1155AwardAddedEventTopic = '0x715f0e2272caaee766e1ebe62e24c026a5126fc316e370c2f696f98bc76eb399';
const ExternalErc1155AwardAddedEvent = MultipleWinnersAbi.find(item => item.name === 'ExternalErc1155AwardAdded') as AbiItem;
// ExternalErc721AwardAdded (index_topic_1 address externalErc721, uint256[] tokenIds)
const ExternalErc721AwardAddedEventTopic = '0x51541dc4b4c08a16085809cccdc4cc77d8000b60fbb00142e57f236d84298675';
const ExternalErc721AwardAddedEvent = MultipleWinnersAbi.find(item => item.name === 'ExternalErc721AwardAdded') as AbiItem;

const typeToTopic = {
    'erc1155': ExternalErc1155AwardAddedEventTopic,
    'erc721': ExternalErc721AwardAddedEventTopic
};

const typeToEvent = {
    'erc1155': ExternalErc1155AwardAddedEvent,
    'erc721': ExternalErc721AwardAddedEvent
};

async function getPots() {
    const response = await axios.get('https://raw.githubusercontent.com/moonpotdev/moonpot-app/main/src/config/vault/bsc.json');
    const data = response.data;

    if (data) {
        return data as AppPot[];
    }

    return null;
}

async function getDeployedBlock(prizeStrategyAddress: string) {
    const response = await axios.get('https://api.bscscan.com/api', {
        params: {
            module: 'logs',
            action: 'getLogs',
            fromBlock: 1,
            toBlock: 'latest',
            address: prizeStrategyAddress,
            topic0: OwnershipTransferredEventTopic,
            apiKey: process.env.BSCSCAN_API_KEY
        }
    });
    const data = response.data;

    if ('message' in data && data.message === 'OK' && data.result) {
        const blocks = data.result.map((result: Record<string, string>) => Web3.utils.hexToNumber(result.blockNumber));
        if (blocks.length > 0) {
            return Math.min(...blocks);
        }
    }

    return null;
}

async function getNftAddedEvents(prizeStrategyAddress: string, deployedAtBlock: number, type: 'erc721' | 'erc1155', web3: Web3): Promise<NftAddedEvent[]> {
    const topic0 = typeToTopic[type];
    const event = typeToEvent[type];

    const response = await axios.get('https://api.bscscan.com/api', {
        params: {
            module: 'logs',
            action: 'getLogs',
            fromBlock: deployedAtBlock,
            toBlock: 'latest',
            address: prizeStrategyAddress,
            topic0: topic0,
            apiKey: process.env.BSCSCAN_API_KEY
        }
    });
    const data = response.data;

    if ('message' in data && data.message === 'OK' && data.result) {
        return data.result
            .map((result: any) => web3.eth.abi.decodeLog(event.inputs as AbiInput[], result.data, result.topics.slice(1)))
            .map((result: any) => ({
                address: result['0'],
                ids: result['1'],
                type
            }));
    }

    return [];
}

function mergeNftAddedEvents(events: NftAddedEvent[]): ConfigNft[] {
    const nfts: Record<string, { address: string, ids: Set<string>, type: 'erc721' | 'erc1155' }> = {};

    for (const event of events) {
        if (event.address in nfts) {
            event.ids.forEach(id => nfts[event.address].ids.add(id));
        } else {
            nfts[event.address] = {
                address: event.address,
                type: event.type,
                ids: new Set(event.ids)
            }
        }
    }

    return Object.values(nfts).map(nft => ({
        address: nft.address,
        type: nft.type,
        ids: [...nft.ids].map(id => Number(id)).sort(numericSort)
    }));
}

async function start() {
    console.log('Loading existing config...')
    const config = await loadConfig();

    const configPot = config.find(pot => pot.id === options.id);
    if (configPot) {
        console.error('Pot with that id already exists in config')
        return;
    }

    console.log('Fetching list of all pots from GitHub...')
    const pots = await getPots();
    if (!pots) {
        console.error('Failed to fetch pots from github')
        return;
    }

    const pot = pots.find(p => p.id === options.id);
    if (!pot) {
        console.error(`Unable to find pot with id of ${options.id}`);
        return;
    }

    if (pot.vaultType !== 'nft') {
        console.error(`${options.id} is not an NFT pot`);
        return;
    }

    console.log('Getting block strategy contract was deployed at from BSCScan...')
    const startBlock = await getDeployedBlock(pot.prizeStrategyAddress);
    if (startBlock === null) {
        console.error(`Failed to get block`);
        return;
    }

    console.log('Connecting to RPC...')
    const web3 = new Web3(process.env.BSC_RPC as string);

    console.log('Getting all ERC721 NFTs deposited to strategy via BSCScan...')
    const erc721events = await getNftAddedEvents(pot.prizeStrategyAddress, startBlock, 'erc721', web3);

    console.log('Getting all ERC1155 NFTs deposited to strategy via BSCScan...')
    const erc1155events = await getNftAddedEvents(pot.prizeStrategyAddress, startBlock, 'erc1155', web3);

    const nfts = mergeNftAddedEvents([...erc721events, ...erc1155events]);

    console.log('Saving new config...');
    await saveConfig([...config, {
        id: pot.id,
        name: pot.name,
        prizeStrategyAddress: pot.prizeStrategyAddress,
        startBlock: startBlock,
        initialNfts: nfts
    }]);
}

let valid = true;
if (!options.id) {
    console.error('Must provide pot id e.g. --id=ziggyverse-armour-nft');
    valid = false;
}

if (!process.env.BSC_RPC) {
    console.error('Must set BSC_RPC url in .env');
    valid = false;
}

if (!process.env.BSCSCAN_API_KEY) {
    console.error('Must set BSCSCAN_API_KEY in .env');
    valid = false;
}

if (!ExternalErc1155AwardAddedEvent || !ExternalErc721AwardAddedEvent) {
    console.error('Failed to read ExternalErc*AwardAdded events from abi');
    valid = false;
}

if (valid) {
    start().catch(console.error);
}