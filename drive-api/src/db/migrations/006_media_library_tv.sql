CREATE TABLE media_sources (
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('series', 'movies')),
  PRIMARY KEY(owner_id, folder_id)
);
CREATE TABLE media_title_settings (
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL,
  name TEXT,
  description TEXT NOT NULL DEFAULT '',
  cover_file_id TEXT REFERENCES files(id) ON DELETE SET NULL,
  watchlist INTEGER NOT NULL DEFAULT 0 CHECK(watchlist IN (0,1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(owner_id, target_id)
);
CREATE TABLE media_file_settings (
  file_id TEXT PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT,
  sort_order INTEGER,
  duration_seconds REAL
);
CREATE TABLE media_subtitles (
  video_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  subtitle_file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  PRIMARY KEY(video_id, subtitle_file_id)
);
CREATE TABLE tv_channels (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  number INTEGER NOT NULL CHECK(number BETWEEN 1 AND 999),
  name TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('shuffle', 'ordered')),
  selected_titles_json TEXT NOT NULL,
  lineup_json TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(owner_id, number)
);
CREATE INDEX idx_tv_channels_owner ON tv_channels(owner_id);
