import {boot} from './controller.ts';

/** LayaAir IDE mainScript calls this after its platform initialization. */
export async function main():Promise<void>{await boot();}
