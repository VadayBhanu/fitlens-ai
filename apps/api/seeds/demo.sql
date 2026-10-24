-- DEMO DATA ONLY. Fictional retailers and offers used by the FitLens demo store
-- (/demo-store/). Every row is flagged is_demo = 1 and the UI labels it as demo data.
-- Load with: npm run db:seed-demo:local  (or :remote)

INSERT OR REPLACE INTO retailers (id, name, domain, verification_status, return_policy, created_at) VALUES
 ('demo-retailer-outlet', 'Demo Outlet', 'demo-outlet.example', 'unverified', 'Free returns within 30 days', '2026-10-01T00:00:00Z'),
 ('demo-retailer-market', 'Demo Marketplace', 'demo-market.example', 'unverified', 'Final sale on discounted items', '2026-10-01T00:00:00Z'),
 ('demo-retailer-boutique', 'Demo Boutique', 'demo-boutique.example', 'unverified', 'Exchanges only within 14 days', '2026-10-01T00:00:00Z');

INSERT OR REPLACE INTO catalog_items (id, retailer_id, external_id, title, brand, style_number, gtin, color, size, product_url, image_url, price_minor, currency, shipping_minor, available, is_demo, updated_at) VALUES
 -- Everyday Organic Crew Tee (GTIN 840000001016, White, M)
 ('demo-ci-01', 'demo-retailer-outlet', 'tee-wht-m', 'Northline Everyday Organic Crew Tee - White', 'Northline', 'NL-TEE-01', '840000001016', 'White', 'M', 'https://demo-outlet.example/p/nl-tee-01?size=M', NULL, 2400, 'USD', 499, 1, 1, '2026-10-24T00:00:00Z'),
 ('demo-ci-02', 'demo-retailer-market', 'nl-tee-01-m', 'Everyday Crew T-Shirt by Northline (White, Medium)', 'Northline', 'NL-TEE-01', '840000001016', 'White', 'Medium', 'https://demo-market.example/item/88231', NULL, 2200, 'USD', 650, 1, 1, '2026-10-24T00:00:00Z'),
 -- Northline Denim Trucker Jacket (GTIN 840000001023, Indigo, M)
 ('demo-ci-03', 'demo-retailer-outlet', 'jkt-ind-m', 'Northline Denim Trucker Jacket Indigo', 'Northline', 'NL-204', '840000001023', 'Indigo', 'M', 'https://demo-outlet.example/p/nl-204?size=M', NULL, 7900, 'USD', 0, 1, 1, '2026-10-24T00:00:00Z'),
 ('demo-ci-04', 'demo-retailer-outlet', 'jkt-ind-l', 'Northline Denim Trucker Jacket Indigo', 'Northline', 'NL-204', '840000001115', 'Indigo', 'L', 'https://demo-outlet.example/p/nl-204?size=L', NULL, 7200, 'USD', 0, 1, 1, '2026-10-24T00:00:00Z'),
 ('demo-ci-05', 'demo-retailer-market', 'nl204-m', 'Denim Trucker Jacket - Northline NL-204 - Size M', 'Northline', 'NL-204', '840000001023', 'Indigo', 'M', 'https://demo-market.example/item/77120', NULL, 7400, 'USD', 899, 1, 1, '2026-10-24T00:00:00Z'),
 ('demo-ci-06', 'demo-retailer-boutique', 'classic-denim', 'Northline Classic Denim Jacket', 'Northline', NULL, NULL, NULL, NULL, 'https://demo-boutique.example/shop/classic-denim', NULL, 9500, 'USD', NULL, NULL, 1, '2026-10-24T00:00:00Z'),
 -- Tidewater Linen Camp Collar Shirt (no GTIN; style TW-11, Sage, M)
 ('demo-ci-07', 'demo-retailer-outlet', 'tw11-sage-m', 'Tidewater Linen Camp Collar Shirt', 'Tidewater', 'TW-11', NULL, 'Sage', 'M', 'https://demo-outlet.example/p/tw-11?color=sage&size=M', NULL, 4900, 'USD', 500, 1, 1, '2026-10-24T00:00:00Z'),
 ('demo-ci-08', 'demo-retailer-market', 'tw11-navy-m', 'Tidewater Linen Camp Shirt TW-11', 'Tidewater', 'TW-11', NULL, 'Navy', 'M', 'https://demo-market.example/item/66410', NULL, 4500, 'USD', 0, 1, 1, '2026-10-24T00:00:00Z');

DELETE FROM reviews WHERE is_demo = 1;
INSERT INTO reviews (id, retailer_id, brand, style_number, gtin, rating, title, body, author, source_url, is_demo, published_at, created_at) VALUES
 ('demo-rv-01', 'demo-retailer-outlet', 'Northline', 'NL-204', '840000001023', 5, 'Great everyday jacket', 'Fits true to size with room for a hoodie underneath. The denim is stiff at first but softens after a few washes.', 'Sam R.', 'https://demo-outlet.example/p/nl-204#reviews', 1, '2026-09-12T00:00:00Z', '2026-10-01T00:00:00Z'),
 ('demo-rv-02', 'demo-retailer-market', 'Northline', 'NL-204', '840000001023', 4, 'Sleeves run long', 'Good quality and color. Sleeves are about an inch long on me; I roll the cuffs.', 'Priya K.', 'https://demo-market.example/item/77120#reviews', 1, '2026-09-20T00:00:00Z', '2026-10-01T00:00:00Z'),
 ('demo-rv-03', 'demo-retailer-outlet', 'Northline', 'NL-204', '840000001023', 3, 'Color lighter than photos', 'Nice construction, but the indigo is lighter in person than on the product page.', 'Jordan T.', 'https://demo-outlet.example/p/nl-204#reviews', 1, '2026-10-02T00:00:00Z', '2026-10-01T00:00:00Z'),
 ('demo-rv-04', 'demo-retailer-outlet', 'Northline', 'NL-TEE-01', '840000001016', 5, 'Soft and thick', 'Heavyweight cotton that holds its shape. Slight shrink after hot wash.', 'Alex M.', 'https://demo-outlet.example/p/nl-tee-01#reviews', 1, '2026-08-30T00:00:00Z', '2026-10-01T00:00:00Z'),
 ('demo-rv-05', 'demo-retailer-market', 'Northline', 'NL-TEE-01', '840000001016', 4, 'Runs slightly big', 'Comfortable, but I would size down for a fitted look.', 'Chris L.', 'https://demo-market.example/item/88231#reviews', 1, '2026-09-05T00:00:00Z', '2026-10-01T00:00:00Z'),
 ('demo-rv-06', 'demo-retailer-outlet', 'Tidewater', 'TW-11', NULL, 4, 'Breathable summer shirt', 'Very breathable linen. Wrinkles easily, as expected.', 'Morgan D.', 'https://demo-outlet.example/p/tw-11#reviews', 1, '2026-07-14T00:00:00Z', '2026-10-01T00:00:00Z');
