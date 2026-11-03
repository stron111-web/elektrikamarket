import 'server-only';
import { shop } from './shop';

export type SavedDelivery = { city: string; cityCode: number; pointCode: string | null; pointAddress: string | null };

export async function savedDelivery(buyerId: string): Promise<SavedDelivery | null> {
  try {
    const rows = await shop()<SavedDelivery[]>`
      SELECT city, city_code AS "cityCode", point_code AS "pointCode", point_address AS "pointAddress"
      FROM delivery_preferences WHERE buyer_id = ${buyerId} LIMIT 1`;
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export async function storeDelivery(buyerId: string, row: { city: string; cityCode: number; pointCode: string | null; pointAddress: string | null }) {
  await shop()`
    INSERT INTO delivery_preferences (buyer_id, city, city_code, point_code, point_address)
    VALUES (${buyerId}, ${row.city}, ${row.cityCode}, ${row.pointCode}, ${row.pointAddress})
    ON CONFLICT (buyer_id) DO UPDATE SET
      city = EXCLUDED.city,
      city_code = EXCLUDED.city_code,
      point_code = CASE
        WHEN EXCLUDED.point_code IS NOT NULL THEN EXCLUDED.point_code
        WHEN delivery_preferences.city_code = EXCLUDED.city_code THEN delivery_preferences.point_code
        ELSE NULL
      END,
      point_address = CASE
        WHEN EXCLUDED.point_address IS NOT NULL THEN EXCLUDED.point_address
        WHEN delivery_preferences.city_code = EXCLUDED.city_code THEN delivery_preferences.point_address
        ELSE NULL
      END,
      updated_at = now()`;
}
