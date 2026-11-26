from nook.services.tech_news.service import TechNews


class JpTechNews(TechNews):
    """国内の技術記事(Zenn / Qiita / note など)を tech_news と同じ手順で集約する。"""

    SERVICE_NAME = "jp_tech_news"
