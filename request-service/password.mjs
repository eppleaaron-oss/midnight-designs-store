import {scryptSync,randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
const password=readFileSync(0,'utf8').trim();
if(password.length<16)throw Error('Use an owner password of at least 16 characters.');
const salt=randomBytes(16).toString('hex');
process.stdout.write(salt+':'+scryptSync(password,salt,64).toString('hex')+'\n');
