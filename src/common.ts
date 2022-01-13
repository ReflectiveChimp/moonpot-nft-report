import {ConfigPot} from './types';
import {loadJson, saveJson} from './helpers';

export async function loadConfig(): Promise<ConfigPot[]> {
    return loadJson<ConfigPot[]>('pots.json');
}

export async function saveConfig(config: ConfigPot[]) {
    return saveJson<ConfigPot[]>('pots.json', config);
}