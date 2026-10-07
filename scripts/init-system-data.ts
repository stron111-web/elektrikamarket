// Run from the project with Node.js 24: node scripts/init-system-data.ts
// Uses the existing postgres dependency; does not require Prisma generation.
const path = require('node:path');
const postgres = require('postgres');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const url = new URL(process.env.DATABASE_URL);
  const schema = url.searchParams.get('schema');
  if (schema && schema !== 'public') throw new Error('Only the public schema is supported');
  url.searchParams.delete('schema');

  const sql = postgres(url.toString(), { max: 1, connect_timeout: 10 });
  try {
    const results = await sql.begin(async (tx) => {
      const outcomes = [];
      for (const warehouse of [
        { code: 'stock1', name: 'Склад 1', sortOrder: 1 },
        { code: 'stock2', name: 'Склад 2', sortOrder: 2 },
        { code: 'stock3', name: 'Склад 3', sortOrder: 3 },
      ]) {
        const created = await tx`
          INSERT INTO public.warehouses (code, name, "sortOrder", "isArchived")
          VALUES (${warehouse.code}, ${warehouse.name}, ${warehouse.sortOrder}, false)
          ON CONFLICT (code) DO NOTHING
          RETURNING id
        `;
        outcomes.push(`${warehouse.code}: ${created.length ? 'created' : 'already exists'}`);
      }
      // updatedAt has no database default: Prisma normally supplies this field.
      const settings = await tx`
        INSERT INTO public.shop_settings (id, "protectiveMarkupPercent", "updatedAt")
        VALUES (1, 30, CURRENT_TIMESTAMP)
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      `;
      outcomes.push(`ShopSettings: ${settings.length ? 'created' : 'already exists'}`);
      return outcomes;
    });
    for (const result of results) console.log(result);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error('System data initialization failed:', error.message);
  process.exitCode = 1;
});
