"""Fetch the latest GomiDev content and write data/content.json.

Run by .github/workflows/deploy.yml on a schedule; can also be run locally:
    pip install -r scripts/requirements.txt
    python scripts/update_content.py

Optional environment variables (set them as repository secrets):
    GITHUB_TOKEN     higher GitHub API rate limit (provided automatically in Actions)
    ITCH_API_KEY     itch.io API key -> lists your itch.io games with ASCII covers
    INSTAGRAM_TOKEN  Instagram API access token -> latest posts with ASCII previews
"""

from __future__ import annotations

import json
import os
import re
import sys
import traceback
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from ascii_art import image_to_ascii  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "config.json"
OUTPUT = ROOT / "data" / "content.json"
LOGO_SRC = ROOT / "logo.png"
LOGO_OUT = ROOT / "assets" / "ascii" / "logo.txt"

USER_AGENT = "GomiDev-site-updater/1.0 (+https://github.com/Grojman/GomiDev)"
GAME_TOPICS = {"game", "videogame", "gamedev", "gomidev-game"}
WIP_TOPICS = {"wip", "in-development", "work-in-progress"}

LOGO_COLS = 56
THUMB_COLS = 48


def log(msg: str) -> None:
    print(f"[update] {msg}", flush=True)


def http_get(url: str, headers: dict | None = None) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, **(headers or {})})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return resp.read()


def http_json(url: str, headers: dict | None = None):
    return json.loads(http_get(url, headers))


def ascii_from_url(url: str | None, cols: int = THUMB_COLS) -> str | None:
    if not url:
        return None
    try:
        return image_to_ascii(http_get(url), cols=cols)
    except Exception as exc:  # a broken thumbnail should never break the whole sync
        log(f"  could not convert image {url}: {exc}")
        return None


def username(value: str | None, pattern: str) -> str | None:
    """Accept either a bare username or a full profile URL (e.g. https://gomidev.itch.io/)."""
    if not value:
        return None
    match = re.search(pattern, value)
    return match.group(1) if match else value.strip().strip("/@")


def norm(text: str | None) -> str:
    return re.sub(r"[^a-z0-9]", "", (text or "").lower())


# --------------------------------------------------------------------------- sources


def fetch_github_repos(cfg: dict) -> list[dict]:
    user = cfg["github"]["user"]
    headers = {"Accept": "application/vnd.github+json"}
    if token := os.environ.get("GITHUB_TOKEN"):
        headers["Authorization"] = f"Bearer {token}"
    repos, page = [], 1
    while True:
        batch = http_json(
            f"https://api.github.com/users/{user}/repos?per_page=100&page={page}&sort=pushed", headers
        )
        repos += batch
        if len(batch) < 100:
            return repos
        page += 1


def repo_entry(repo: dict) -> dict:
    topics = set(repo.get("topics") or [])
    return {
        "title": repo["name"],
        "repo": repo["name"],
        "repo_url": repo["html_url"],
        "website": repo.get("homepage") or None,
        "description": repo.get("description"),
        "language": repo.get("language"),
        "stars": repo.get("stargazers_count", 0),
        "status": "wip" if topics & WIP_TOPICS else "released",
        "updated": repo.get("pushed_at"),
        "topics": sorted(topics),
    }


def split_repos(cfg: dict, repos: list[dict]) -> tuple[list[dict], list[dict]]:
    gh = cfg["github"]
    exclude = {r.lower() for r in gh.get("exclude", [])}
    game_names = {r.lower() for r in gh.get("game_repos", [])}
    games, software = [], []
    for repo in repos:
        if repo.get("fork") or repo["name"].lower() in exclude:
            continue
        is_game = repo["name"].lower() in game_names or set(repo.get("topics") or []) & GAME_TOPICS
        (games if is_game else software).append(repo_entry(repo))
    return games, software


def fetch_itch_games(cfg: dict) -> list[dict]:
    key = os.environ.get("ITCH_API_KEY")
    if not key:
        log("itch.io: ITCH_API_KEY not set, skipping (manual entries in config.json still apply)")
        return []
    data = http_json(f"https://itch.io/api/1/{key}/my-games")
    games = []
    for g in data.get("games", []):
        games.append(
            {
                "title": g.get("title"),
                "itch": g.get("url"),
                "description": g.get("short_text"),
                "status": "released" if g.get("published") else "wip",
                "updated": g.get("published_at") or g.get("created_at"),
                "ascii": ascii_from_url(g.get("cover_url")),
            }
        )
    log(f"itch.io: {len(games)} games")
    return games


def resolve_youtube_channel(cfg: dict) -> str | None:
    yt = cfg["youtube"]
    if yt.get("channel_id"):
        return yt["channel_id"]
    handle = (yt.get("handle") or "").lstrip("@")
    if not handle:
        return None
    html = http_get(f"https://www.youtube.com/@{handle}", {"Accept-Language": "en"}).decode("utf-8", "ignore")
    match = re.search(r'"(?:channelId|externalId)":"(UC[\w-]{22})"', html)
    if not match:
        raise RuntimeError(f"could not resolve channel id for @{handle}; set youtube.channel_id in config.json")
    return match.group(1)


def fetch_youtube(cfg: dict) -> list[dict]:
    channel_id = resolve_youtube_channel(cfg)
    if not channel_id:
        log("youtube: no handle/channel_id configured, skipping")
        return []
    ns = {
        "a": "http://www.w3.org/2005/Atom",
        "yt": "http://www.youtube.com/xml/schemas/2015",
        "media": "http://search.yahoo.com/mrss/",
    }
    root = ET.fromstring(http_get(f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}"))
    videos = []
    for entry in root.findall("a:entry", ns)[: cfg["limits"]["youtube"]]:
        vid = entry.findtext("yt:videoId", namespaces=ns)
        videos.append(
            {
                "title": entry.findtext("a:title", namespaces=ns),
                "url": entry.find("a:link", ns).get("href"),
                "date": entry.findtext("a:published", namespaces=ns),
                "ascii": ascii_from_url(f"https://i.ytimg.com/vi/{vid}/mqdefault.jpg"),
            }
        )
    log(f"youtube: {len(videos)} videos")
    return videos


def fetch_instagram(cfg: dict) -> list[dict]:
    token = os.environ.get("INSTAGRAM_TOKEN")
    if not token:
        log("instagram: INSTAGRAM_TOKEN not set, skipping")
        return []
    fields = "caption,media_type,media_url,thumbnail_url,permalink,timestamp"
    query = urllib.parse.urlencode({"fields": fields, "limit": cfg["limits"]["instagram"], "access_token": token})
    data = http_json(f"https://graph.instagram.com/me/media?{query}")
    posts = []
    for p in data.get("data", []):
        image = p.get("thumbnail_url") if p.get("media_type") == "VIDEO" else p.get("media_url")
        caption = (p.get("caption") or "").strip().splitlines()
        posts.append(
            {
                "title": caption[0][:120] if caption else None,
                "url": p.get("permalink"),
                "date": p.get("timestamp"),
                "ascii": ascii_from_url(image),
            }
        )
    log(f"instagram: {len(posts)} posts")
    return posts


# --------------------------------------------------------------------------- merging


def merge_entries(base: list[dict], extra: list[dict]) -> list[dict]:
    """Merge `extra` into `base`, matching by repo, itch url or title. Non-null fields of `extra` win."""
    result = [dict(e) for e in base]
    for item in extra:
        match = next(
            (
                e
                for e in result
                if (item.get("repo") and norm(item["repo"]) == norm(e.get("repo")))
                or (item.get("itch") and item["itch"] == e.get("itch"))
                or (item.get("title") and norm(item["title"]) == norm(e.get("title")))
            ),
            None,
        )
        clean = {k: v for k, v in item.items() if v is not None}
        if match is None:
            result.append(clean)
        else:
            match.update(clean)
    return result


def sort_by_date(items: list[dict]) -> list[dict]:
    return sorted(items, key=lambda e: e.get("updated") or "", reverse=True)


# --------------------------------------------------------------------------- main


def main() -> None:
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    previous = json.loads(OUTPUT.read_text(encoding="utf-8")) if OUTPUT.exists() else {}
    prev_media = previous.get("media", {})
    errors: list[str] = []

    def attempt(name: str, fn, fallback):
        try:
            return fn()
        except Exception as exc:
            log(f"{name}: FAILED ({exc}); keeping previous data")
            traceback.print_exc()
            errors.append(name)
            return fallback

    if LOGO_SRC.exists():
        LOGO_OUT.write_text(image_to_ascii(LOGO_SRC, cols=LOGO_COLS) + "\n", encoding="utf-8")

    repos = attempt("github", lambda: fetch_github_repos(cfg), None)
    if repos is not None:
        gh_games, gh_software = split_repos(cfg, repos)
        log(f"github: {len(repos)} repos -> {len(gh_games)} games, {len(gh_software)} software")
        recent = [
            {"title": r["name"], "url": r["html_url"], "date": r.get("pushed_at"), "description": r.get("description")}
            for r in sorted(repos, key=lambda r: r.get("pushed_at") or "", reverse=True)
            if not r.get("fork") and r["name"].lower() not in {x.lower() for x in cfg["github"].get("exclude", [])}
        ][: cfg["limits"]["github"]]
    else:
        gh_games = [g for g in previous.get("games", []) if g.get("repo")]
        gh_software = [s for s in previous.get("software", []) if s.get("repo")]
        recent = prev_media.get("github", {}).get("items", [])

    itch_games = attempt("itch", lambda: fetch_itch_games(cfg), [g for g in previous.get("games", []) if g.get("itch") and not g.get("repo")])
    videos = attempt("youtube", lambda: fetch_youtube(cfg), prev_media.get("youtube", {}).get("items", []))
    posts = attempt("instagram", lambda: fetch_instagram(cfg), prev_media.get("instagram", {}).get("items", []))

    games = merge_entries(merge_entries(gh_games, itch_games), cfg.get("games", []))
    software = merge_entries(gh_software, cfg.get("software", []))

    gh_user = cfg["github"]["user"]
    yt = cfg["youtube"]
    yt_url = (
        f"https://www.youtube.com/@{yt['handle'].lstrip('@')}"
        if yt.get("handle")
        else f"https://www.youtube.com/channel/{yt['channel_id']}" if yt.get("channel_id") else None
    )
    ig_user = username(cfg["instagram"].get("user"), r"instagram\.com/([\w.]+)")
    itch_user = username(cfg["itch"].get("user"), r"([\w-]+)\.itch\.io")

    content = {
        "profiles": {
            "github": f"https://github.com/{gh_user}",
            "itch": f"https://{itch_user}.itch.io" if itch_user else None,
            "youtube": yt_url,
            "instagram": f"https://www.instagram.com/{ig_user}/" if ig_user else None,
            "amazon": cfg["amazon"].get("author_url"),
        },
        "games": sort_by_date(games),
        "software": sort_by_date(software),
        "books": cfg.get("books", []),
        "media": {
            "github": {"url": f"https://github.com/{gh_user}", "items": recent},
            "youtube": {"url": yt_url, "items": videos},
            "instagram": {"url": f"https://www.instagram.com/{ig_user}/" if ig_user else None, "items": posts},
        },
    }

    old = {k: v for k, v in previous.items() if k != "generated_at"}
    if content == old:
        log("no changes")
    else:
        content["generated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT.write_text(json.dumps(content, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        log(f"wrote {OUTPUT.relative_to(ROOT)}")

    if errors:
        log(f"finished with errors in: {', '.join(errors)}")


if __name__ == "__main__":
    main()
