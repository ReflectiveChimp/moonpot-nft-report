export interface AppPot {
    id: string
    name: string
    vaultType: string
    prizeStrategyAddress: string
}

export interface NftAddedEvent {
    address: string
    ids: string[]
    type: 'erc721' | 'erc1155'
}

export interface ConfigNft {
    address: string,
    type: "erc721" | "erc1155",
    ids: number[]
}

export interface ConfigPot {
    id: string
    name: string
    prizeStrategyAddress: string,
    startBlock: number,
    initialNfts: ConfigNft[]
}