import feedparser
from bs4 import BeautifulSoup

feed_config = {"url": "https://www.36kr.com/feed"}

feed = feedparser.parse(feed_config["url"])
# pprint(feed)
print(
    BeautifulSoup(
        feed.entries[0].get("summary_detail", {}).get("value", ""), "html.parser"
    ).get_text()
)
