import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

async function main() {
  const argPassword = process.argv[2];
  let password = argPassword;

  if (!password) {
    const rl = readline.createInterface({ input, output });
    try {
      password = await rl.question('Enter admin password to hash: ');
    } finally {
      rl.close();
    }
  }

  if (!password || password.length < 8) {
    console.error('Error: Password must be at least 8 characters long.');
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 12);
  const suggestedJwtSecret = crypto.randomBytes(32).toString('hex');

  console.log('\nAdd these to your .env file:\n');
  console.log(`APP_ADMIN_PASS_HASH=${hash}`);
  console.log(`JWT_SECRET=${suggestedJwtSecret}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
