WITH delta_text AS (
  SELECT
    message_id,
    string_agg(COALESCE(text_delta, ''), '' ORDER BY created_at, id) AS text_delta
  FROM conversation_message_deltas
  GROUP BY message_id
),
delta_parts AS (
  SELECT
    d.message_id,
    jsonb_agg(part.value ORDER BY d.created_at, d.id, part.ordinality) AS new_parts
  FROM conversation_message_deltas d
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(d.new_parts, '[]'::jsonb))
    WITH ORDINALITY AS part(value, ordinality)
  GROUP BY d.message_id
),
collapsed AS (
  SELECT
    m.id,
    COALESCE(m.content, '') || COALESCE(dt.text_delta, '') AS content,
    COALESCE(
      (
        SELECT jsonb_agg(existing_part.value ORDER BY existing_part.ordinality)
        FROM jsonb_array_elements(COALESCE(m.parts, '[]'::jsonb))
          WITH ORDINALITY AS existing_part(value, ordinality)
        WHERE existing_part.value ->> 'type' <> 'text'
      ),
      '[]'::jsonb
    ) AS existing_non_text_parts,
    COALESCE(dp.new_parts, '[]'::jsonb) AS new_parts
  FROM conversation_messages m
  JOIN delta_text dt ON dt.message_id = m.id
  LEFT JOIN delta_parts dp ON dp.message_id = m.id
)
UPDATE conversation_messages m
SET
  content = collapsed.content,
  parts = CASE
    WHEN collapsed.content <> ''
      THEN jsonb_build_array(jsonb_build_object('type', 'text', 'text', collapsed.content))
    ELSE '[]'::jsonb
  END || collapsed.existing_non_text_parts || collapsed.new_parts,
  updated_at = now()
FROM collapsed
WHERE m.id = collapsed.id;
--> statement-breakpoint

UPDATE conversation_messages m
SET
  content = CASE
    WHEN btrim(COALESCE(m.content, '')) = ''
      THEN 'Generation was interrupted during the chat durability migration.'
    ELSE rtrim(m.content) || E'\n\n[Generation was interrupted during the chat durability migration.]'
  END,
  parts = COALESCE(m.parts, '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object(
      'type',
      'text',
      'text',
      CASE
        WHEN btrim(COALESCE(m.content, '')) = ''
          THEN 'Generation was interrupted during the chat durability migration.'
        ELSE E'\n\n[Generation was interrupted during the chat durability migration.]'
      END
    )
  ),
  status = 'error',
  updated_at = now()
WHERE m.status = 'generating'
  AND NOT EXISTS (
    SELECT 1
    FROM agent_runs r
    WHERE r.assistant_message_id = m.id
      AND r.status IN ('queued', 'running', 'waiting_for_approval')
  );
--> statement-breakpoint

DROP TABLE conversation_message_deltas;
