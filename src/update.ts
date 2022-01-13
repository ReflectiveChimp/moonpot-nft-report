import {loadConfig} from './common';
import {ERC1155Abi, ERC721Abi, MultipleWinnersAbi} from './abi';
import {MultiCall} from 'eth-multicall';
import Web3 from 'web3';
import mkdirp from 'mkdirp';
import {fileExists, loadJson, numericSort, saveJson, saveString} from './helpers';
import {AbiItem} from 'web3-utils';
import axios from 'axios';
import BigNumber from 'bignumber.js';
import commandLineArgs from 'command-line-args';
import {ConfigPot} from './types';
import pLimit from 'p-limit';
import { format as dateFormat } from 'date-fns'
import ejs from 'ejs';

const options = commandLineArgs([
    {name: 'id', alias: 'i', type: String},
]);

const typeToAbi: Record<string, AbiItem[]> = {
    erc721: ERC721Abi,
    erc1155: ERC1155Abi,
}

const typeToUriMethod: Record<string, string> = {
    erc721: 'tokenURI',
    erc1155: 'uri',
}

const typeToRemainingMethod: Record<string, string> = {
    erc721: 'getExternalErc721AwardTokenIds',
    erc1155: 'getExternalErc1155AwardTokenIds',
}

async function getIdsLeft(nftAddress: string, strategyAddress: string, type: 'erc721' | 'erc1155', web3: Web3) {
    const contract = new web3.eth.Contract(MultipleWinnersAbi, strategyAddress);
    const method = typeToRemainingMethod[type];
    const ids = (await contract.methods[method](nftAddress).call());
    return [...ids].map(id => Number(id)).sort(numericSort);
}

async function fetchMetadata(nftAddress: string, nftId: number, type: 'erc721' | 'erc1155', web3: Web3): Promise<Metadata> {
    const contract = new web3.eth.Contract(typeToAbi[type], nftAddress);
    const method = typeToUriMethod[type];
    const url = await contract.methods[method](new BigNumber(nftId)).call();
    const response = await axios.get(url);
    const data = response.data as Metadata;
    data.address = nftAddress;
    data.id = nftId;
    return data;
}

async function fetchAndCacheMetadata(nftAddress: string, nftId: number, type: 'erc721' | 'erc1155', cachePath: string, web3: Web3): Promise<Metadata> {
    const data = await fetchMetadata(nftAddress, nftId, type, web3);
    await mkdirp(`cache/meta/${nftAddress}`);
    await saveJson(cachePath, data);
    return data;
}

interface Metadata {
    address: string
    id: number
    name: string
    [k: string]: any
}

async function getMetadata(nftAddress: string, nftId: number, type: 'erc721' | 'erc1155', web3: Web3): Promise<Metadata> {
    const cachePath = `cache/meta/${nftAddress}/${nftId}.json`;
    const exists = await fileExists(cachePath);

    if (!exists) {
        return fetchAndCacheMetadata(nftAddress, nftId, type, cachePath, web3);
    }

    return loadJson(cachePath);
}

async function savePot(pot: Record<string, any>, nfts: Record<string, any>[], remainingIds: string[]) {
    return saveJson(`cache/${pot.id}.json`, {
        ...pot,
        nfts,
        remainingIds
    });
}

async function getAllRemainingIds(pots: ConfigPot[], web3: Web3, multicall: MultiCall): Promise<Record<string, Record<string, number[]>>> {
    const calls = pots.map(pot => pot.initialNfts.map(nft => {
        const contract = new web3.eth.Contract(MultipleWinnersAbi, pot.prizeStrategyAddress);

        const method = typeToRemainingMethod[nft.type];
        return {
            pot: pot.id,
            nft: nft.address,
            remaining: contract.methods[method](nft.address)
        }
    }));
    const results = await multicall.all(calls);

    return Object.fromEntries(results.map((potResults: any) =>
        ([potResults[0].pot, Object.fromEntries(potResults.map((result: any) =>
            ([result.nft, result.remaining.map((id: string) => Number(id)).sort(numericSort)])
        ))])
    ));
}

async function fetchMissingMetadata(pots: ConfigPot[], web3: Web3) {
    const limiter = pLimit(5);
    const tasks = pots.map(pot => pot.initialNfts.map(nft => nft.ids.map(id => limiter(() => getMetadata(nft.address, id, nft.type, web3))).flat()).flat()).flat();
    const results = await Promise.all(tasks);
    const metas: Record<string, Record<number, Metadata>> = {};

    for(const result of results) {
        if ( !(result.address in metas) ) {
            metas[result.address] = {}
        }

        metas[result.address][result.id] = result;
    }

    return metas;
}

async function start() {
    console.log('Loading config...')
    const config = await loadConfig();
    if (!config || config.length === 0) {
        console.error('No pots in pots.json');
        return;
    }

    let pots = config;
    // If we only want to update 1 pot
    if (options.id) {
        const configPot = config.find(pot => pot.id === options.id);
        if (!configPot) {
            console.error(`No pot with id ${options.id} found in in pots.json`);
            return;
        }

        pots = [configPot];
    }

    console.log('Connecting to RPC...')
    const web3 = new Web3(process.env.BSC_RPC as string);
    const multicall = new MultiCall(web3, '0xB94858b0bB5437498F5453A16039337e5Fdc269C');

    console.log('Fetching any missing NFT metadata... (may take a long time)');
    const metadata = await fetchMissingMetadata(pots, web3);

    console.log('Querying remaining ids...')
    const remaining = await getAllRemainingIds(pots, web3, multicall);

    console.log('Building data...')
    const now = new Date();
    const outputPots = pots.map(pot => ({
        id: pot.id,
        name: pot.name,
        nfts: pot.initialNfts.map(nft => ({
            address: nft.address,
            ids: nft.ids.map(id => ({
                id: id,
                awarded: !remaining[pot.id][nft.address].includes(id),
                meta: metadata[nft.address][id]
            })),
            initialCounts: nft.ids.reduce((counts, id) => {
                counts[metadata[nft.address][id].name] = (counts[metadata[nft.address][id].name] || 0) + 1;
                return counts
            }, {} as Record<string, number>),
            remainingCounts: remaining[pot.id][nft.address].reduce((counts, id) => {
                counts[metadata[nft.address][id].name] = (counts[metadata[nft.address][id].name] || 0) + 1;
                return counts
            }, {} as Record<string, number>)
        }))
    }));

    console.log('Generating output...');
    const html = await ejs.renderFile('template.ejs', {
        date: dateFormat(now, 'yyyy-MM-dd\'T\'HH:mm:ss'),
        pots: outputPots
    });

    console.log('Saving output...');
    const path =`output/${dateFormat(now, 'yyyyMMddHHmmss')}.html`;
    await saveString(path, html);
    console.log(`Saved to ${path}`);
}

let valid = true;

if (!process.env.BSC_RPC) {
    console.error('Must set BSC_RPC url in .env');
    valid = false;
}

if (valid) {
    start().catch(console.error);
}