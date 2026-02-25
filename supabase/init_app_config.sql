-- Gemini Chat — app_config table initialization
-- Run this in Supabase SQL Editor before first use

CREATE TABLE IF NOT EXISTS app_config (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Initial default values (will be auto-populated by the app if table exists but is empty)
INSERT INTO app_config (key, value) VALUES
('chat_models', '[
  {"id":"gemini-3.1-pro-preview","label":"3.1 Pro","group":"Gemini 3.x"},
  {"id":"gemini-3-pro-preview","label":"3.0 Pro","group":"Gemini 3.x"},
  {"id":"gemini-3-flash-preview","label":"3.0 Flash","group":"Gemini 3.x"},
  {"id":"gemini-2.5-pro","label":"2.5 Pro","group":"Gemini 2.5"},
  {"id":"gemini-2.5-flash","label":"2.5 Flash","group":"Gemini 2.5"},
  {"id":"gemini-2.5-flash-lite","label":"2.5 Flash Lite","group":"Gemini 2.5"},
  {"id":"gemini-2.0-flash","label":"2.0 Flash","group":"Gemini 2.0"},
  {"id":"gemini-2.0-flash-lite","label":"2.0 Flash Lite","group":"Gemini 2.0"}
]'),
('default_chat_model', '"gemini-3-flash-preview"'),
('memory_summary_model', '"gemini-3-flash-preview"'),
('memory_embedding_model', '"gemini-embedding-001"'),
('image_gen_model', '"gemini-2.5-flash-image"')
ON CONFLICT (key) DO NOTHING;
