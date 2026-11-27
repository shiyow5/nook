-- 用語辞書の画面(#17)で使う項目。
-- reading は頭文字の索引に使う読み(ひらがな)。漢字の語でも「か行」などに振り分けるため
-- status は learning(これから覚える)か understood(理解できた)
ALTER TABLE terms ADD COLUMN reading TEXT;
ALTER TABLE terms ADD COLUMN note TEXT;
ALTER TABLE terms ADD COLUMN important INTEGER NOT NULL DEFAULT 0;
ALTER TABLE terms ADD COLUMN status TEXT NOT NULL DEFAULT 'learning' CHECK (status IN ('learning', 'understood'));
