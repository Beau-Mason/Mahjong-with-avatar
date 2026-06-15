#!/usr/bin/env python3
# 開発用の静的サーバ。ブラウザキャッシュを無効化して dist/ を配信する。
#   python3 serve.py [port]
import sys, http.server, os

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8099
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'dist')

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, max-age=0')
        super().end_headers()

print(f'serving {ROOT} at http://localhost:{PORT}/  (no-cache)')
http.server.ThreadingHTTPServer(('', PORT), Handler).serve_forever()
