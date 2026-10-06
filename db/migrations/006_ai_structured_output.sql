UPDATE settings SET value='false', updated_at=datetime('now')
WHERE key='ai_unload' AND value='true'
  AND EXISTS (SELECT 1 FROM settings WHERE key='ai_model' AND value='qwen3.5:0.8b');

UPDATE settings SET value='qwen3.5:4b', updated_at=datetime('now')
WHERE key='ai_model' AND value='qwen3.5:0.8b';
