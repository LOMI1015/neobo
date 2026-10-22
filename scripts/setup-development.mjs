import { constants } from 'node:fs';
import { chmod, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const example = fileURLToPath(new URL('../.env.example', import.meta.url));
const target = fileURLToPath(new URL('../.env', import.meta.url));

try {
  await copyFile(example, target, constants.COPYFILE_EXCL);
  await chmod(target, 0o600);
  console.log('Created local .env from .env.example. Existing project data was not changed.');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log('Local .env already exists; kept your configuration.');
}
