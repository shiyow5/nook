-- 閲覧履歴(#73)。詳細画面で開いた記事を 1 本 1 行で残し、開き直したら日時と回数を更新する。
-- 題名などは記録した時点で R2 の記事から写す。日時は ISO 8601(UTC)の文字列。90 日より前の行は消す
CREATE TABLE reading_history (
  app TEXT NOT NULL,
  day TEXT NOT NULL,
  article_id TEXT NOT NULL,
  title TEXT NOT NULL,
  source TEXT,
  image TEXT,
  first_viewed_at TEXT NOT NULL,
  last_viewed_at TEXT NOT NULL,
  view_count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (app, day, article_id)
);
CREATE INDEX reading_history_by_last_viewed_at ON reading_history (last_viewed_at DESC);
