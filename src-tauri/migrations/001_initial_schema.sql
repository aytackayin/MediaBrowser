-- Initial schema for Media Browser

CREATE TABLE IF NOT EXISTS folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT UNIQUE NOT NULL,
    last_scanned TIMESTAMP
);

CREATE TABLE IF NOT EXISTS media_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    folder_id INTEGER,
    path TEXT UNIQUE NOT NULL,
    filename TEXT NOT NULL,
    file_type TEXT NOT NULL, -- 'image', 'video', 'audio'
    size INTEGER NOT NULL,
    mtime INTEGER NOT NULL,
    duration REAL, -- Only for video/audio
    width INTEGER, -- Only for image/video
    height INTEGER, -- Only for image/video
    thumbnail_path TEXT,
    metadata JSON,
    FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_media_files_folder ON media_files(folder_id);
CREATE INDEX IF NOT EXISTS idx_media_files_type ON media_files(file_type);
