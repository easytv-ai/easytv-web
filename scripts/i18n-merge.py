#!/usr/bin/env python3
"""
把翻译结果合并进 i18n/locales/*.json 顶层（key = 中文原文）。

用法：python3 scripts/i18n-merge.py <en.json> <zh-TW.json> <ja.json>
fr / ru / vi 暂用英文译文（回退链见 i18n/i18n.config.ts）。
"""
import json, sys, re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
keys = [k for k in (ROOT / 'scripts/i18n-keys.txt').read_text().split('\n') if k]
en, tw, ja = (json.load(open(p)) for p in sys.argv[1:4])
PH = re.compile(r'\{(\w+)\}')

# 同事按「命名 key + 插值译文」写的几条（key 本身没有占位符），放行
NAMED_KEYS = {'剩余天数有效', '审片候选条数'}

def check(name, d):
    missing = [k for k in keys if k not in d]
    bad = [k for k in keys if k in d and k not in NAMED_KEYS and not set(PH.findall(d[k])) <= set(PH.findall(k)) | {'pct', 'save'}]
    if missing or bad:
        raise SystemExit(f'{name}: missing={missing[:5]} badPlaceholders={bad[:5]}')

for name, d in (('en', en), ('zh-TW', tw), ('ja', ja)):
    check(name, d)

# zh 本身不需要词条，但带占位符的 key 必须存在，否则回退到 key 时不做插值
targets = {'en': en, 'zh-TW': tw, 'ja': ja, 'fr': en, 'ru': en, 'vi': en, 'zh': {k: k for k in keys if '{' in k}}
for lang, src in targets.items():
    p = ROOT / 'i18n/locales' / f'{lang}.json'
    data = json.load(open(p))
    # 只增改 keys.txt 里的词条，不删别的：同事会直接往 locale 文件里加不在 keys.txt 的中文 key，
    # 以前「先删掉旧的中文 key 再追加」会把那些一起删掉（2026-09-24 差点删掉 342 条）
    for k in keys:
        if k in src:
            data[k] = src[k]
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    print(lang, len(keys), 'keys merged')
