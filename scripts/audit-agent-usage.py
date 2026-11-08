"""Read local histories; retain only counters, hashes, paths and session identifiers.

This is a retrospective measurement, not a billing or causal attribution model.
Python 3.10+, standard library only. No subprocesses, network or source-log writes.
Run --self-test, or --start ISO --end ISO --output path/to/summary.json.
The end of the window is exclusive; specify an explicit UTC offset.
Tool labels are overlapping lexical hints, not executed-command counts.
poll_only_usage counts model responses issuing only polling/wait calls; it is not
the amount that can necessarily be saved. Kimi tool calls are not inventoried.
"""
import argparse
import collections as C
import datetime as dt
import hashlib
import json
import pathlib
import re

HOME = pathlib.Path.home()
START = '2026-10-23T00:00:00+03:00'
END = '2026-11-08T00:00:00+03:00'
MSK = dt.timezone(dt.timedelta(hours=3))

def timestamp(value):
    if not value:
        return None
    try:
        return dt.datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()
    except (ValueError, TypeError):
        return None

def records(path):
    with path.open(encoding='utf-8') as stream:
        for line in stream:
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                counters['invalid_json_lines'] += 1

def normalize(vendor, usage):
    if vendor == 'claude':
        fresh = usage.get('input_tokens', 0)
        write = usage.get('cache_creation_input_tokens', 0)
        cached = usage.get('cache_read_input_tokens', 0)
        inp = fresh + write + cached
        reasoning = (usage.get('output_tokens_details') or {}).get('thinking_tokens', 0)
    else:
        inp = usage.get('input_tokens', 0)
        cached = usage.get('cached_input_tokens', 0)
        write = usage.get('cache_write_input_tokens', 0)
        fresh = inp - cached - write
        reasoning = usage.get('reasoning_output_tokens', 0)
    out = usage.get('output_tokens', 0)
    assert min(inp, cached, write, fresh, out) >= 0
    return dict(input=inp, cached=cached, cache_write=write,
                uncached_excluding_write=fresh, output=out, reasoning_subset=reasoning,
                total=inp + out)

RULES = {
    'device': r'device\.mjs|\badb\b|scrcpy|uiautomator|scripts/usb|npm run usb',
    'build_install': r'eas\s+build|gradlew|\bgradle\b|expo\s+run:|adb[^\n;]*\binstall\b|build:android|build:ios',
    'maestro': r'maestro|npm\s+run\s+e2e',
    'checks': r'npm\s+run\s+(?:check|typecheck|lint|test)|\bjest\b|\btsc\b|\beslint\b',
    'read_search': r'\brg\b|Get-Content|\bcat\s|\bsed\s|\bgrep\b|Select-String|\bfind\s|Get-ChildItem',
    'edit': r'apply_patch|Set-Content|WriteAllText|write_text|writeFileSync|writeFile\(',
    'git': r'\bgit\s+(?:status|diff|log|show|switch|checkout|commit|merge|add|branch)',
    'backend': r'\bpsql\b|\bssh\b|supabase|selfhost|docker',
    'profiling': r'perfetto|ffmpeg|ffprobe|gfxinfo|device\.mjs\s+(?:record|frames)',
    'recovery': r'device\.mjs\s+reset|kill-server|taskkill|force-stop|--clear|\breboot\b',
}

def classify(name, args):
    labels = {key for key, pattern in RULES.items() if re.search(pattern, args, re.I)}
    lname = name.lower()
    if lname in ['read', 'glob', 'grep', 'ls']:
        labels.add('read_search')
    if lname in ['edit', 'write', 'multiedit', 'apply_patch']:
        labels.add('edit')
    if re.search(r'wait|sleep|taskoutput|write_stdin', lname) or re.search(r'tools\.(?:write_stdin|.*sleep|.*wait)\(', args):
        labels.add('wait_poll')
    if re.search(r'view_image|readmedia|image', lname):
        labels.add('image_inspect')
    if re.search(r'agent|task$', lname):
        labels.add('delegate')
    return sorted(labels or {'other'})

def add_call(vendor, ident, root, ts, name, args):
    if not ident or timestamp(ts) is None:
        return
    key = vendor + ':' + ident
    text = args if isinstance(args, str) else json.dumps(args, ensure_ascii=False)
    item = dict(root=root, time=ts, tool=name, labels=classify(name, text),
                signature=hashlib.sha256((name + text).encode()).hexdigest())
    nested = re.findall(r'tools\.(\w+)\s*\(', text)
    item['poll_only'] = name in ['wait', 'write_stdin', 'sleep', 'TaskOutput'] or bool(nested) and all(n in ['write_stdin', 'clock__sleep'] for n in nested)
    if key not in calls:
        calls[key] = item
    elif calls[key]['signature'] != item['signature']:
        counters['call_id_content_conflicts'] += 1

def add_usage(vendor, ident, root, session, ts, usage, model, branch=None):
    if not ident or not usage or timestamp(ts) is None:
        return
    key = vendor + ':' + ident
    row = dict(vendor=vendor, root=root, session=session, time=ts,
               usage=normalize(vendor, usage), model=model, branch=branch)
    naive[vendor].update(row['usage'])
    if timestamp(START) <= timestamp(ts) < timestamp(END):
        naive_window[vendor].update(row['usage'])
    if key in responses:
        counters[vendor + '_duplicate_usage_rows'] += 1
        old = responses[key]
        if old['root'] != root:
            cross_roots.add(key)
        # Split assistant blocks repeat usage; preserve the largest cumulative output
        # observed for this same response, not the sum of blocks.
        if old['usage'] != row['usage']:
            counters[vendor + '_usage_variants'] += 1
            for k, n in row['usage'].items():
                old['usage'][k] = max(old['usage'][k], n)
            old['usage']['total'] = old['usage']['input'] + old['usage']['output']
    else:
        responses[key] = row

def claude():
    base = HOME / '.claude/projects/D--Projects-open'
    paths = list(base.rglob('*.jsonl'))
    counters['claude_files_scanned'] = len(paths)
    for path in paths:
        rel = path.relative_to(base)
        parent = rel.parts[0] if len(rel.parts) > 1 else path.stem
        for d in records(path):
            typ = d.get('type')
            sid = d.get('sessionId', parent)
            # Copied records retain their original sessionId in many histories.
            root = parent if len(rel.parts) > 1 else sid
            ts = d.get('timestamp')
            if typ == 'assistant':
                m = d.get('message', {})
                add_usage('claude', m.get('id'), root, path.stem, ts,
                          m.get('usage'), m.get('model'), d.get('gitBranch'))
                for b in m.get('content', []):
                    if isinstance(b, dict) and b.get('type') == 'tool_use':
                        add_call('claude', b.get('id'), root, ts, b.get('name', ''), b.get('input', {}))
            elif typ == 'user':
                content = d.get('message', {}).get('content', [])
                if isinstance(content, list):
                    for b in content:
                        if isinstance(b, dict) and b.get('type') == 'tool_result':
                            cid = b.get('tool_use_id')
                            if cid:
                                result_errors['claude:' + cid] = bool(b.get('is_error'))
            elif typ == 'system' and d.get('subtype') == 'compact_boundary':
                if timestamp(ts) is not None and timestamp(START) <= timestamp(ts) < timestamp(END):
                    compactions.add(('claude', d.get('uuid', ''), root))

def codex():
    for path in (HOME / '.codex/sessions').rglob('*.jsonl'):
        stream = records(path)
        first = next(stream, {})
        meta = first.get('payload', {})
        if not re.fullmatch(r'd:[\\/]projects[\\/]open', meta.get('cwd', ''), re.I):
            continue
        counters['codex_files_scanned'] += 1
        root = meta.get('id', path.stem)
        source = meta.get('source', {})
        if isinstance(source, dict):
            spawn = source.get('subagent', {}).get('thread_spawn', {})
            root = spawn.get('parent_thread_id', root)
        session = meta.get('id', path.stem)
        model = None
        pending = []
        has_usage = False
        last_cumulative = {}
        legacy = []
        for d in stream:
            p = d.get('payload', {})
            ts = d.get('timestamp')
            if d.get('type') == 'turn_context':
                model = p.get('model', model)
            elif d.get('type') == 'token_usage_record':
                has_usage = True
                owner = root if root != session else p.get('thread_id', root)
                add_usage('codex', p.get('response_id'), owner,
                          session, ts, p.get('usage'), model)
                key = 'codex:' + (p.get('response_id') or '')
                if key in responses:
                    responses[key]['poll_only'] = bool(pending) and all(calls[c]['poll_only'] for c in pending if c in calls)
                pending = []
            elif d.get('type') == 'response_item':
                typ = p.get('type')
                if typ in ['function_call', 'custom_tool_call']:
                    add_call('codex', p.get('call_id', p.get('id')), root, ts,
                             p.get('name', ''), p.get('arguments', p.get('input', '')))
                    pending.append('codex:' + (p.get('call_id', p.get('id')) or ''))
                elif typ in ['function_call_output', 'custom_tool_call_output']:
                    out = p.get('output', '')
                    text = out if isinstance(out, str) else json.dumps(out)
                    match = re.search(r'(?:exit_code["\s:]+|Process exited with code\s+)(\d+)', text)
                    if match:
                        result_errors['codex:' + p.get('call_id', '')] = int(match[1]) != 0
            elif d.get('type') == 'event_msg' and p.get('type') == 'token_count':
                info = p.get('info') or {}
                total = info.get('total_token_usage')
                if total:
                    delta = {k: v - last_cumulative.get(k, 0) for k, v in total.items() if isinstance(v, int)}
                    last_cumulative = total
                    if any(v < 0 for v in delta.values()):
                        counters['codex_cumulative_reset'] += 1
                        delta = total
                    if delta.get('total_tokens', 0) > 0:
                        legacy.append((ts, delta, model))
            elif d.get('type') == 'compacted':
                if timestamp(START) <= timestamp(ts) < timestamp(END):
                    compactions.add(('codex', ts, root))
        if not has_usage:
            counters['codex_legacy_files'] += 1
            for ts, usage, model in legacy:
                add_usage('codex', session + ':' + ts, root, session, ts, usage, model)

def kimi():
    base = HOME / '.kimi-code/sessions'
    for state_path in base.glob('*/session_*/state.json'):
        state = json.loads(state_path.read_text(encoding='utf-8'))
        if not re.fullmatch(r'd:[\\/]projects[\\/]open', state.get('cwd', ''), re.I):
            continue
        root = state_path.parent.name.removeprefix('session_')
        for path in state_path.parent.glob('agents/*/wire.jsonl'):
            counters['kimi_files_scanned'] += 1
            for index, d in enumerate(records(path)):
                if d.get('type') != 'usage.record':
                    continue
                u = d['usage']
                # usage.record is emitted once per request, including compaction.
                # token_counting.* records measure context, not request consumption.
                cached = u.get('inputCacheRead', 0)
                write = u.get('inputCacheCreation', 0)
                usage = dict(input_tokens=u.get('inputOther', 0) + cached + write,
                             cached_input_tokens=cached, cache_write_input_tokens=write,
                             output_tokens=u.get('output', 0))
                ts = dt.datetime.fromtimestamp(d['time'] / 1000, dt.timezone.utc).isoformat()
                ident = root + ':' + path.parent.name + ':' + str(index)
                add_usage('kimi', ident, root, path.parent.name, ts, usage, d.get('model'))

def summarize(start, end):
    lo, hi = timestamp(start), timestamp(end)
    sums = {}
    daily = C.defaultdict(C.Counter)
    for row in responses.values():
        if not lo <= timestamp(row['time']) < hi:
            continue
        key = row['vendor'] + ':' + row['root']
        s = sums.setdefault(key, dict(vendor=row['vendor'], root=row['root'],
            usage=C.Counter(), responses=0, sessions=set(), branches=C.Counter(), models=C.Counter(),
            first=row['time'], last=row['time'], input_sizes=[], tool_labels=C.Counter(), tools=C.Counter(),
            tool_calls=0, repeat_signatures=C.Counter(), errors_observed=0, compactions=0,
            poll_only_responses=0, poll_only_usage=C.Counter()))
        s['usage'].update(row['usage']);s['responses'] += 1
        s['sessions'].add(row['session']);s['models'][row['model']] += 1
        if row['branch']:s['branches'][row['branch']] += 1
        s['first'] = min(s['first'], row['time']);s['last'] = max(s['last'], row['time'])
        s['input_sizes'].append(row['usage']['input'])
        if row.get('poll_only'):
            s['poll_only_responses'] += 1
            s['poll_only_usage'].update(row['usage'])
        day = dt.datetime.fromtimestamp(timestamp(row['time']), MSK).date().isoformat()
        daily[row['vendor'] + ':' + day].update(row['usage'])
    for cid, call in calls.items():
        if not lo <= timestamp(call['time']) < hi:
            continue
        key = cid.split(':')[0] + ':' + call['root']
        if key in sums:
            s = sums[key];s['tool_calls'] += 1;s['tools'][call['tool']] += 1
            s['tool_labels'].update(call['labels']);s['repeat_signatures'][call['signature']] += 1
            s['errors_observed'] += int(result_errors.get(cid, False))
    for vendor, _, root in compactions:
        if vendor + ':' + root in sums:
            sums[vendor + ':' + root]['compactions'] += 1
    for s in sums.values():
        s['sessions'] = sorted(s['sessions'])
        sizes = sorted(s.pop('input_sizes'))
        s['median_input_per_response'] = sizes[len(sizes)//2]
        s['max_input_per_response'] = max(sizes)
        s['repeated_tool_arguments'] = sum(n-1 for n in s.pop('repeat_signatures').values())
    return dict(window=dict(start=start, end_exclusive=end), counters=counters,
                cross_root_duplicate_responses=len(cross_roots),
                naive_window_usage_before_deduplication=naive_window,
                daily=dict(daily), sessions=sorted(sums.values(), key=lambda s:s['usage']['total'], reverse=True))

def initialize():
    global counters, responses, calls, result_errors, compactions, cross_roots, naive, naive_window
    counters = C.Counter();responses = {};calls = {};result_errors = {};compactions = set();cross_roots = set()
    naive = C.defaultdict(C.Counter);naive_window = C.defaultdict(C.Counter)

def self_test():
    initialize()
    u = dict(input_tokens=2, cache_creation_input_tokens=10, cache_read_input_tokens=100, output_tokens=7)
    assert normalize('claude', u)['total'] == 119
    assert normalize('codex', dict(input_tokens=112, cached_input_tokens=100, output_tokens=7))['total'] == 119
    ts = '2026-11-01T00:00:00Z'
    add_usage('claude', 'same', 'root', 'root', ts, u, 'test')
    add_usage('claude', 'same', 'copy', 'copy', ts, u, 'test')
    assert len(responses) == 1
    u = dict(u, output_tokens=20)
    add_usage('claude', 'same', 'root', 'root', ts, u, 'test')
    assert responses['claude:same']['usage']['total'] == 132
    add_call('codex', 'poll', 'root', ts, 'exec', 'text(await tools.write_stdin({session_id:1}));')
    add_call('codex', 'mixed', 'root', ts, 'exec', 'await tools.write_stdin({});await tools.exec_command({});')
    assert calls['codex:poll']['poll_only'] and not calls['codex:mixed']['poll_only']
    assert 'wait_poll' in calls['codex:poll']['labels']
    assert not summarize('2026-11-02T00:00:00Z', END)['sessions']
    assert len(summarize(START, END)['sessions']) == 1
    print('self-test: normalization, deduplication, streaming usage, polling, time window OK')

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--start', default=START)
    parser.add_argument('--end', default=END)
    parser.add_argument('--output', type=pathlib.Path)
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args()
    if args.self_test:
        self_test()
        raise SystemExit(0)
    if args.output is None:
        parser.error('--output is required unless --self-test is used')
    START, END = args.start, args.end
    initialize()
    claude();codex();kimi()
    result = summarize(args.start, args.end)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'sessions':len(result['sessions']), 'counters':counters,
                      'cross_root_duplicate_responses':len(cross_roots)}, ensure_ascii=False))
