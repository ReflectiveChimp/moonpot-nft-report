import {AbiItem} from 'web3-utils';
import MultipleWinnersJson from './MultipleWinners.json';
import ERC1155Json from './ERC1155.json';
import ERC721Json from './ERC721.json';

export const MultipleWinnersAbi = MultipleWinnersJson as AbiItem[];
export const ERC1155Abi = ERC1155Json as AbiItem[];
export const ERC721Abi = ERC721Json as AbiItem[];