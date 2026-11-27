-- 過去記事のアーカイブ(#15)の索引。R2 の Markdown を Worker が読み、検索と絞り込み用に写す。
-- 本文は要約の文字だけ(HTML は持たない)。tags は「|語|語|」の形で、LIKE '%|語|%' で絞り込む
CREATE TABLE archive_articles (
  app TEXT NOT NULL,
  day TEXT NOT NULL,
  article_id TEXT NOT NULL,
  title TEXT NOT NULL,
  source TEXT,
  link TEXT,
  image TEXT,
  lead TEXT NOT NULL,
  body TEXT NOT NULL,
  tags TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (app, day, article_id)
);
CREATE INDEX archive_by_day ON archive_articles (day DESC, app, position);

-- 索引に入れた日。同じ Markdown(updated_at が同じ)なら入れ直さない
CREATE TABLE archive_days (
  app TEXT NOT NULL,
  day TEXT NOT NULL,
  source_updated_at TEXT,
  article_count INTEGER NOT NULL,
  indexed_at TEXT NOT NULL,
  PRIMARY KEY (app, day)
);
