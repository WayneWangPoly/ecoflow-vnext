#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import subprocess
from pathlib import Path

APP_PATH = Path('src/app/App.tsx')
EXPECTED_GIT_BLOB_SHA = 'e7c0637e4e29ebb8a6081f4eb84c4f080af6872f'


def git_blob_sha(payload: bytes) -> str:
    header = f'blob {len(payload)}\0'.encode()
    return hashlib.sha1(header + payload).hexdigest()


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected exactly one match, found {count}')
    return source.replace(old, new, 1)


def main() -> None:
    payload = APP_PATH.read_bytes()
    actual_sha = git_blob_sha(payload)
    if actual_sha != EXPECTED_GIT_BLOB_SHA:
        raise RuntimeError(
            f'App.tsx source drifted: expected {EXPECTED_GIT_BLOB_SHA}, found {actual_sha}'
        )

    source = payload.decode('utf-8')
    source = replace_once(
        source,
        "import { DashboardPage } from '@/features/dashboard/DashboardPage';\n",
        "import { DashboardPage } from '@/features/dashboard/DashboardPage';\n"
        "import { DesktopRouteBoundary } from '@/features/intelligence/navigation/DesktopRouteBoundary';\n"
        "import { useDesktopRouteAdapter } from '@/features/intelligence/navigation/useDesktopRouteAdapter';\n",
        'route-shell imports',
    )
    source = replace_once(
        source,
        "  const [tab, setTab] = useState<DesktopTab>('dashboard');\n",
        "  const { tab, setTab, boundary } = useDesktopRouteAdapter(role);\n",
        'desktop tab authority',
    )
    source = replace_once(
        source,
        "  const effectiveOrders = useMemo(() => applyDayStateToOrders(orders, day), [orders, day]);\n\n"
        "  return (\n",
        "  const effectiveOrders = useMemo(() => applyDayStateToOrders(orders, day), [orders, day]);\n\n"
        "  if (boundary) {\n"
        "    return (\n"
        "      <DesktopShell role={role} tab={tab} setTab={setTab} onLogout={onLogout}>\n"
        "        <DesktopRouteBoundary boundary={boundary} />\n"
        "      </DesktopShell>\n"
        "    );\n"
        "  }\n\n"
        "  return (\n",
        'desktop route boundary',
    )

    APP_PATH.write_text(source, encoding='utf-8')
    subprocess.run(['git', 'diff', '--check', '--', str(APP_PATH)], check=True)
    print('INTEL-FE-001B App.tsx patch applied with all exact anchors.')


if __name__ == '__main__':
    main()
