# moonpot-nft-report

## Requirements

- Node 16.X
- Yarn

## Installation

$ `yarn install`

Copy `.env.example` to `.env` and fill in `BSCSCAN_API_KEY` with your BSCScan.com APY Key (free tier)

## Usage

### Adding a new pot

Will fetch pot information and initial nfts, saves to `pots.json`

$ `yarn run add --id=ziggyverse-agility-nft`

`--id` must be equal to a pot id from the moonpot-app

### Updating & Output

Fetches metadata for all NFTs and finds which ones are left to be awarded.

Output will be saved to `output/<timestamp>.html`

#### Single pot 

$ `yarn run update --id=ziggyverse-agility-nft`

#### All pots

$ `yarn run update`