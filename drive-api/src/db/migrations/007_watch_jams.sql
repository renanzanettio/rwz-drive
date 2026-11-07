CREATE TABLE watch_jams (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  host_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  playlist_json TEXT NOT NULL,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  position_seconds REAL NOT NULL DEFAULT 0,
  anchored_at INTEGER NOT NULL,
  paused INTEGER NOT NULL DEFAULT 1,
  playback_rate REAL NOT NULL DEFAULT 1,
  guests_control INTEGER NOT NULL DEFAULT 0,
  auto_next INTEGER NOT NULL DEFAULT 1,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  closed_at INTEGER
);
CREATE INDEX idx_watch_jams_host ON watch_jams(host_user_id, expires_at);
CREATE TABLE watch_jam_members (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES watch_jams(id) ON DELETE CASCADE,
  secret_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('host','guest')),
  last_seen_at INTEGER NOT NULL,
  left_at INTEGER
);
CREATE INDEX idx_watch_jam_members_room ON watch_jam_members(room_id, last_seen_at);
