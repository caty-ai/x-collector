BEGIN;

SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '5min';

-- Serialize collectors and normalization with this backfill, including source edits.
LOCK TABLE gh_sources, gh_items, pipeline_items IN ACCESS EXCLUSIVE MODE;

CREATE TEMP TABLE gh_release_key_map ON COMMIT DROP AS
SELECT g.id AS old_id, lower(s.repo) || ':' || g."tagName" AS new_id
FROM gh_items g
JOIN gh_sources s ON s.id = g."sourceId"
WHERE g.type = 'release'
  AND g.id = g."tagName"
  AND s.repo IS NOT NULL
  AND g."tagName" IS NOT NULL;

-- Preserve every pipeline item and its dependent records; detach only colliding keys.
-- Keep an existing destination key, or one old key per destination for duplicate tags.
-- Detached items retain their content and can be matched by URL on the next normalize run.
UPDATE pipeline_items p
SET "externalId" = NULL
FROM gh_release_key_map m
WHERE p.platform = 'github' AND p."externalId" = m.old_id
  AND (
    EXISTS (
      SELECT 1 FROM pipeline_items target
      WHERE target.platform = 'github' AND target."externalId" = m.new_id
    )
    OR EXISTS (
      SELECT 1 FROM pipeline_items other
      JOIN gh_release_key_map other_map ON other."externalId" = other_map.old_id
      WHERE other.platform = 'github' AND other_map.new_id = m.new_id
        AND other.id < p.id
    )
  );

UPDATE pipeline_items p
SET "externalId" = m.new_id
FROM gh_release_key_map m
WHERE p.platform = 'github' AND p."externalId" = m.old_id;

-- Prefer a release already fetched with the new key over its legacy duplicate.
DELETE FROM gh_items g
USING gh_release_key_map m
WHERE g.id = m.old_id
  AND (
    EXISTS (SELECT 1 FROM gh_items target WHERE target.id = m.new_id)
    OR EXISTS (
      SELECT 1 FROM gh_release_key_map other
      WHERE other.new_id = m.new_id AND other.old_id < m.old_id
    )
  );

UPDATE gh_items g
SET id = m.new_id
FROM gh_release_key_map m
WHERE g.id = m.old_id;

COMMIT;
