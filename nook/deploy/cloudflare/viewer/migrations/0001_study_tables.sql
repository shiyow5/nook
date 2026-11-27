-- 学習データ(#13)。利用者が書き込むものを置き、記事の本文(R2)とは分ける。
-- 記事は (app, day, article_id) で指す。R2 の 90 日の自動削除で本文が消えても、
-- お気に入りの記事は markdown 列に写しを残す。日時はすべて ISO 8601(UTC)の文字列。

-- お気に入り(#14)
CREATE TABLE favorites (
  app TEXT NOT NULL,
  day TEXT NOT NULL,
  article_id TEXT NOT NULL,
  title TEXT NOT NULL,
  source TEXT,
  link TEXT,
  image TEXT,
  markdown TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (app, day, article_id)
);
CREATE INDEX favorites_by_created_at ON favorites (created_at DESC);

-- 記事へのメモ(#16)。quote は記事中で選んだ語や文
CREATE TABLE notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app TEXT NOT NULL,
  day TEXT NOT NULL,
  article_id TEXT NOT NULL,
  quote TEXT,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX notes_by_article ON notes (app, day, article_id);

-- 用語辞書(#16、#17)。同じ語は大文字と小文字を区別せず 1 つにまとめる
CREATE TABLE terms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  word TEXT NOT NULL COLLATE NOCASE UNIQUE,
  explanation TEXT NOT NULL,
  app TEXT,
  day TEXT,
  article_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- AI とのやり取りの記録(添削 #19、ケーススタディ #20 など)。input / output は JSON 文字列
CREATE TABLE ai_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  app TEXT,
  day TEXT,
  article_id TEXT,
  input TEXT NOT NULL,
  output TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX ai_sessions_by_kind ON ai_sessions (kind, created_at DESC);
