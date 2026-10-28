#!/usr/bin/env python3
"""
创作台多语言改造脚本：把 .vue 里写死的中文改成 t('中文原文')。

约定：翻译 key 就是中文原文（与 easyapi 前端一致的做法）。zh 不需要词条，
en / zh-TW / ja 在 i18n/locales/*.json 顶层用中文原文作 key 提供译文，缺失时回退到中文。

用法：
  python3 scripts/i18n-studio.py --dry  file.vue ...   # 只列出会被替换的字符串与需要人工处理的项
  python3 scripts/i18n-studio.py        file.vue ...   # 就地改写，并把 key 追加到 scripts/i18n-keys.txt
"""
import re
import sys
import json
from pathlib import Path

CJK = r'[一-龥]'
ATTRS = ['placeholder', 'title', 'aria-label', 'alt', 'label', 'description', 'hint', 'page-title', 'page-description']
BAD_KEY = re.compile(r'[.@|{}$]')  # vue-i18n 消息语法保留字符，含这些的字符串留给人工

def esc(s: str) -> str:
    return s.replace("\\", "\\\\").replace("'", "\\'")

def process(src: str, report: list, keys: set):
    # ---- split sections ----
    m = re.search(r'<script setup lang="ts">(.*?)</script>', src, re.S)
    t_idx = src.find('<template>')
    if not m or t_idx < 0:
        report.append('  ! 没有 <script setup> 或 <template>，跳过')
        return src
    script = m.group(1)
    template = src[t_idx:]
    head = src[:t_idx]

    # ---- template: text nodes ----
    def repl_text(mo):
        before, text, after = mo.group(1), mo.group(2), mo.group(3)
        inner = text.strip()
        if not re.search(CJK, inner) or '{{' in inner:
            if re.search(CJK, inner) and '{{' in inner:
                report.append(f'  ~ 混合插值文本需人工: {inner[:60]}')
            return mo.group(0)
        if BAD_KEY.search(inner):
            report.append(f'  ~ 含保留字符需人工: {inner[:60]}')
            return mo.group(0)
        keys.add(inner)
        lead = text[:len(text) - len(text.lstrip())]
        trail = text[len(text.rstrip()):]
        return f"{before}{lead}{{{{ t('{esc(inner)}') }}}}{trail}{after}"
    template = re.sub(r'(>)([^<>{}]*?)(<)', repl_text, template)

    # ---- template: attributes ----
    def repl_attr(mo):
        space, name, val = mo.group(1), mo.group(2), mo.group(3)
        if not re.search(CJK, val):
            return mo.group(0)
        if BAD_KEY.search(val):
            report.append(f'  ~ 属性含保留字符需人工: {name}="{val[:50]}"')
            return mo.group(0)
        keys.add(val)
        return f'{space}:{name}="t(\'{esc(val)}\')"'
    template = re.sub(r'(\s)(' + '|'.join(ATTRS) + r')="([^"]*)"', repl_attr, template)

    # ---- script: plain single-quoted literals ----
    def repl_lit(mo):
        val = mo.group(1)
        if not re.search(CJK, val):
            return mo.group(0)
        if BAD_KEY.search(val):
            report.append(f'  ~ 脚本字符串含保留字符需人工: {val[:60]}')
            return mo.group(0)
        keys.add(val)
        return f"t('{esc(val)}')"
    # 不处理已在 t('...') 里的、以及 import 路径
    lines = []
    for line in script.split('\n'):
        stripped = line.strip()
        if stripped.startswith('import ') or stripped.startswith('//') or stripped.startswith('*') or stripped.startswith('/*'):
            lines.append(line)
            continue
        if '`' in line and re.search(CJK, line):
            report.append(f'  ~ 模板字符串需人工: {stripped[:90]}')
        line = re.sub(r"(?<!t\()'((?:[^'\\\n]|\\.)*)'", repl_lit, line)
        lines.append(line)
    script = '\n'.join(lines)

    # ---- ensure useI18n ----
    if 't(' in script + template and 'useI18n()' not in script:
        script = "\nconst { t } = useI18n()" + script if script.startswith('\n') else "\nconst { t } = useI18n()\n" + script
    new_head = head.replace(m.group(1), script, 1)
    return new_head + template

def main():
    dry = '--dry' in sys.argv
    files = [a for a in sys.argv[1:] if a != '--dry']
    all_keys = set()
    for f in files:
        p = Path(f)
        src = p.read_text(encoding='utf-8')
        report = []
        keys = set()
        out = process(src, report, keys)
        print(f'== {f}: {len(keys)} keys')
        for r in report:
            print(r)
        if not dry and out != src:
            p.write_text(out, encoding='utf-8')
        all_keys |= keys
    keyfile = Path('scripts/i18n-keys.txt')
    existing = set(keyfile.read_text(encoding='utf-8').split('\n')) if keyfile.exists() else set()
    if not dry:
        keyfile.write_text('\n'.join(sorted(k for k in (existing | all_keys) if k)), encoding='utf-8')
    print(f'\ntotal new keys: {len(all_keys - existing)}')
    if dry:
        print(json.dumps(sorted(all_keys), ensure_ascii=False, indent=0))

if __name__ == '__main__':
    main()
