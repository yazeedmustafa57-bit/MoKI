import fs from 'node:fs';
import { hashPassword } from '../server/auth.js';

let password = process.env.OWNER_BOOTSTRAP_PASSWORD;
if (password === undefined) {
  if (process.stdin.isTTY) {
    console.error('Bitte das Passwort über stdin übergeben, z. B. aus einem Passwortmanager.');
    process.exit(1);
  }
  password = fs.readFileSync(0, 'utf8').replace(/\r?\n$/, '');
}
if (password.length < 10) {
  console.error('Das Bootstrap-Passwort muss mindestens 10 Zeichen lang sein.');
  process.exit(1);
}
const hash = await hashPassword(password);
process.stdout.write(`${hash}\n`);
