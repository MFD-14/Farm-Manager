-- Field outlines (Google Earth import and "walk the boundary"). locations.geom
-- already holds a GeoJSON polygon; geom_meta records its area and where it came
-- from, and geom_proposed holds a caretaker's walked outline until an owner or
-- task manager uses or discards it.
ALTER TABLE locations ADD COLUMN IF NOT EXISTS geom_meta jsonb;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS geom_proposed jsonb;
