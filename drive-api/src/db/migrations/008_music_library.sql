CREATE TABLE music_tracks (
  file_id TEXT PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT,
  artist TEXT,
  album TEXT,
  duration_seconds REAL,
  favorite INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_music_tracks_owner ON music_tracks(owner_id);
CREATE TABLE music_playlists (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  cover_file_id TEXT REFERENCES files(id) ON DELETE SET NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_music_playlists_owner ON music_playlists(owner_id);
CREATE TABLE music_playlist_items (
  playlist_id TEXT NOT NULL REFERENCES music_playlists(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL,
  PRIMARY KEY(playlist_id,file_id)
);
ALTER TABLE watch_jams ADD COLUMN media_kind TEXT NOT NULL DEFAULT 'video' CHECK(media_kind IN ('audio','video'));
