-- Reference-data fidelity: block sizes and soils (prototype field map), herd
-- breed composition and housing, so the app carries the real Woodlands Farm.
ALTER TABLE locations ADD COLUMN IF NOT EXISTS hectares numeric;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS soil text;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE herds ADD COLUMN IF NOT EXISTS breed text;
ALTER TABLE herds ADD COLUMN IF NOT EXISTS location text;
ALTER TABLE herds ADD COLUMN IF NOT EXISTS notes text;
-- Layers versus broilers: egg collection (P-04) only applies to laying flocks.
ALTER TABLE batches ADD COLUMN IF NOT EXISTS purpose text;
