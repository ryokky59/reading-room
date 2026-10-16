-- Initial feed set (formerly feeds.json).
INSERT INTO "feeds" ("name", "url", "category", "item_limit", "days") VALUES
  ('Hacker News (100pt以上)', 'https://hnrss.org/frontpage?points=100', 'tech', 10, 3),
  ('はてブ テクノロジー', 'https://b.hatena.ne.jp/hotentry/it.rss', 'tech', 10, 3),
  ('Publickey', 'https://www.publickey1.jp/atom.xml', 'tech', 5, 3),
  ('Zenn トレンド', 'https://zenn.dev/feed', 'tech', 5, 3),
  ('Qiita 人気', 'https://qiita.com/popular-items/feed', 'tech', 5, 3),
  ('TechCrunch', 'https://techcrunch.com/feed/', 'tech', 5, 3),
  ('The Pragmatic Engineer', 'https://blog.pragmaticengineer.com/rss/', 'tech', 5, 14),
  ('はてブ 政治と経済', 'https://b.hatena.ne.jp/hotentry/economics.rss', 'business', 10, 3),
  ('Stratechery', 'https://stratechery.com/feed/', 'business', 5, 14),
  ('Lenny''s Newsletter', 'https://www.lennysnewsletter.com/feed', 'business', 5, 14),
  ('Coral Capital', 'https://coralcap.co/feed/', 'business', 5, 14),
  ('Business Insider Japan', 'https://www.businessinsider.jp/feed/', 'business', 5, 3),
  ('日経クロステック', 'https://xtech.nikkei.com/rss/xtech-it.rdf', 'business', 5, 3)
ON CONFLICT ("url") DO NOTHING;
