-- Farm brief (Oct 2026): the reticulation mainline is tracked as an asset while
-- it is upgraded from 40 mm PVC and sprinklers to 63 mm HDPE and drip.
ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_kind_check;
ALTER TABLE assets ADD CONSTRAINT assets_kind_check CHECK (kind IN ('pump','borehole','tank','pool','drip_block','sprayer',
  'generator','coop','kraal','fence_section','vehicle','tool','pipeline'));
