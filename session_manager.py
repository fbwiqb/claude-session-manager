import os, sys, time, threading, webbrowser
from csm import paths, indexer, server

def _web_dir():
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, "web")

def main():
    pdir = paths.projects_dir()
    if not os.path.isdir(pdir):
        print("세션 폴더를 찾을 수 없습니다:", pdir)
        print("CLAUDE_CONFIG_DIR 환경변수를 확인하세요.")
        input("엔터로 종료...")
        return
    cfg = {
        "projects_dir": pdir, "db": paths.index_db_path(),
        "fav": paths.favorites_path(), "trash_dir": paths.trash_dir(),
        "trash_meta": paths.trash_meta_path(), "web_dir": _web_dir(),
    }
    print("인덱싱 중... (첫 실행은 수십 초 걸릴 수 있어요)")
    n = indexer.build_index(pdir, cfg["db"],
        progress=lambda i, t: print(f"  {i}/{t}", end="\r"))
    print(f"\n인덱싱 완료 (갱신 {n}개).")
    port = 8765
    httpd = server.make_server(cfg, port=port)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{port}/"
    print("열기:", url)
    webbrowser.open(url)
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        httpd.shutdown()

if __name__ == "__main__":
    main()
