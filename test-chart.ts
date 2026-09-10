import { getDb } from './src/lib/db';
const db = getDb();
console.log(db.prepare('SELECT count(*) FROM trades').get());
