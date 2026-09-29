import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
export const root=path.resolve(process.env.GUEST_ROOT||path.join(os.homedir(),'Desktop/exit-matrix'));
const my98=path.resolve(process.env.MY98_SOURCE||'../my98');
export const {chromium,webkit}=createRequire(path.join(my98,'package.json'))('playwright');
