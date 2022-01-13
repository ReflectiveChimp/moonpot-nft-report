import fs, {promises as fsPromises} from 'fs';

export async function saveJson<DataType = any>(path: string, json: DataType) {
    return fsPromises.writeFile(path, JSON.stringify(json));
}

export async function loadJson<ReturnType = any>(path: string): Promise<ReturnType> {
    const json = await fsPromises.readFile(path, 'utf-8');
    return JSON.parse(json);
}

export async function saveString(path: string, data: string) {
    return fsPromises.writeFile(path, data);
}

export async function fileExists(path: string) {
    return new Promise<boolean>((resolve) => {
        fs.access(path, fs.constants.F_OK, err => {
            resolve(!err);
        });
    })
}

export const numericSort = (a: number, b: number) => a - b;