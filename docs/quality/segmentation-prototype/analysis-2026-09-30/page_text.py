"""Shared pieces of the review pages: transcript paragraphs and the page's colours and type."""

import html
import re

SENTENCE_END = re.compile(r"(?<=[.?!])\s+(?=[A-Z\[\"'])")
TURN = re.compile(r"^(So|Now|Okay|OK|Right|Then|But|And so|Alright|All right|Well)\b")
SOFT_WORDS, HARD_WORDS = 60, 120


def paragraphs(text: str) -> str:
    """Break a transcript at sentence ends: at a change of tack past SOFT_WORDS, always past HARD_WORDS."""
    out: list[list[str]] = [[]]
    words = 0
    for sentence in SENTENCE_END.split(text.strip()):
        if words >= HARD_WORDS or (words >= SOFT_WORDS and TURN.match(sentence)):
            out.append([])
            words = 0
        out[-1].append(sentence)
        words += len(sentence.split())
    return "".join(f"<p>{html.escape(' '.join(p))}</p>" for p in out if p)


FONTS = """<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap">"""

TOKENS = """:root{
  --ground:#f6f7f8; --surface:#ffffff; --ink:#14181c; --muted:#5c646c;
  --rule:#dee3e8; --topic:#17606d; --topic-soft:#e4f0f2; --sub:#6d4a76; --flag:#8a5a1c; --flag-soft:#f6ecdd;
  --ui:"IBM Plex Sans",system-ui,-apple-system,sans-serif;
  --serif:"Source Serif 4",Georgia,"Times New Roman",serif;
  --mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  color-scheme:dark;
  --ground:#0e1216; --surface:#151a1f; --ink:#e4e8ec; --muted:#939ba3;
  --rule:#242b32; --topic:#6bc2d0; --topic-soft:#12292f; --sub:#c3a2cb; --flag:#d5a05a; --flag-soft:#2b2214;
}}
:root[data-theme="dark"]{
  color-scheme:dark;
  --ground:#0e1216; --surface:#151a1f; --ink:#e4e8ec; --muted:#939ba3;
  --rule:#242b32; --topic:#6bc2d0; --topic-soft:#12292f; --sub:#c3a2cb; --flag:#d5a05a; --flag-soft:#2b2214;
}"""
