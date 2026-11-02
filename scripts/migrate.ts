import 'dotenv/config';
import { migrateToLatest } from '../src/db/migrator';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
migrateToLatest(url, console.log)
  .then((applied) =>
    console.log(applied.length ? `done (${applied.length} applied)` : 'up to date'),
  )
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
