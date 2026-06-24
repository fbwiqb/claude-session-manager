# 클로드 세션 매니저 (CSM) — 설계 문서

작성일: 2026-06-24

## 목적

`~/.claude/projects/`에 쌓인 클로드 코드 세션(현재 약 16,000개)을 한 화면에서
조회·검색·분석하고, 즐겨찾기·리네임·삭제로 관리한다. 본문(대화 내용)을 직접
보고, 클릭 한 번으로 해당 세션을 cmd 창에서 `claude -r`로 바로 이어서 켤 수 있다.

## 형태

- Python 표준 라이브러리(`http.server` 등)만 사용하는 **웹 로컬앱**. 외부 의존성 0.
- 단일 코드베이스(`session_manager.py`). 완성 후 **PyInstaller로 단일 exe** 패키징.
- 실사용 산출물 = `세션매니저.exe` 하나(본인·공유 대상 모두 exe 더블클릭).
- 개발 중에는 `.py`를 직접 실행해 빠르게 반복.
- 설치 위치: `C:\Users\신도경\Desktop\세션매니저\` (소스 + 빌드 exe).

## 경로 자동 탐색 (사람마다 경로 다름 해결)

세션 폴더 위치를 하드코딩하지 않고 런타임에 결정한다:

1. 환경변수 `CLAUDE_CONFIG_DIR`가 있으면 그 안의 `projects/`
2. 없으면 `os.path.expanduser("~")/.claude/projects/`
3. 둘 다 없으면 UI에서 "폴더를 직접 지정" 폴백

`claude` 실행파일은 경로를 박지 않고 이름으로만 호출(`claude -r <id>`) → 설치 시
PATH에 등록되므로 위치 무관. 못 찾으면 에러를 잡아 안내(앱 안 죽음).

## 아키텍처 (4개 단위)

### 1. 인덱서 (indexer)
- `<projects>/**/*.jsonl`을 스캔해 세션별 메타를 추출 → SQLite 캐시 `csm-index.db`.
- **mtime 기반 증분 갱신**: 파일 경로+mtime을 캐시와 대조, 변경/신규 파일만 재파싱.
  첫 실행만 느림(16K, 수십 초~1분), 이후엔 즉시.
- 추출 필드: `session_id`, `project`(폴더명 디코딩), `file_path`, `mtime`,
  `title`(custom-title 최신값), `first_prompt`(첫 user 메시지 요약),
  `msg_count`, `size_bytes`, `model`, `last_activity`.
- `_trash/` 폴더는 스캔 대상에서 제외.

### 2. 서버 API
- `GET /api/list` — 검색어·정렬·필터(즐겨찾기/프로젝트/정리추천) 적용한 목록.
- `GET /api/transcript?sid=` — 해당 세션 jsonl을 파싱해 user/assistant 메시지 배열 반환.
- `POST /api/rename` — custom-title 레코드를 jsonl에 **append**(덮어쓰기 아님).
- `POST /api/favorite` — 즐겨찾기 토글(`csm-fav.json`).
- `POST /api/delete` — 세션 파일을 `_trash/`로 **이동**(영구삭제 아님), 원경로 기록.
- `POST /api/restore` — 휴지통에서 원위치 복원.
- `GET /api/open?sid=` — 새 콘솔 창에서 `claude -r <id>` 실행
  (`subprocess.Popen(['cmd','/k','claude','-r',sid], creationflags=CREATE_NEW_CONSOLE)`).

### 3. 웹 UI (다크 테마, 자리뽑기 앱 톤)
- 좌측 리스트: 검색창 + ⭐즐겨찾기 필터 + 프로젝트 드롭다운 + 정렬(최근/이름/활동량) +
  "정리추천만 보기" 토글. 각 행에 날짜·이름·프로젝트·메시지수·정리추천 뱃지.
- 우측 패널: 메타 정보 + **본문 뷰어**(메시지 말풍선) + 버튼
  (⭐즐겨찾기 · ✏️리네임 · ▶️cmd에서 열기 · 🗑️휴지통).
- 휴지통 보기 탭: 삭제된 세션 + 복원 버튼.

### 4. 데이터 저장
- 리네임 → 해당 세션 jsonl에 native와 동일한 `{"type":"custom-title",...}` 레코드 append.
  `claude -r` 피커와 동기화. **구현 시 native가 쓰는 정확한 대상 파일을 먼저 검증**
  (홈 디렉토리는 bridge-session 집계 파일에 쓰일 수 있음 — 안전 최우선).
- 즐겨찾기 → `csm-fav.json` (session_id 목록).
- 삭제 → `<projects>/_trash/`로 이동 + `csm-trash.json`에 (원경로, 시각) 기록.

## 정리 추천 로직

`오래됨(예: 30일+) AND 짧음(msg_count ≤ 2) AND 이름없음(title 비어있음) AND 즐겨찾기 아님`
= 삭제후보 뱃지. UI에서 후보만 필터 → 일괄 휴지통 이동 지원.

## 안전장치

- 삭제는 **휴지통 이동만**(영구삭제 기능 없음). 비우기는 별도 명시 동작.
- 리네임은 **append-only**(기존 jsonl 라인 수정/삭제 안 함).
- 즐겨찾기·이름붙은 세션은 정리추천에서 자동 제외.
- 경로/실행파일 미발견 시 폴백·안내(앱 비종료).

## 테스트

- 인덱서: 샘플 jsonl에서 custom-title/첫프롬프트/카운트 정확 추출.
- 증분 갱신: mtime 안 바뀐 파일은 재파싱 스킵 확인.
- 휴지통: 이동→복원 왕복으로 원경로 복구 확인.
- 리네임: append 후 재인덱싱 시 새 이름 반영 확인.
- open: `claude` PATH 없을 때 에러 핸들링.

## 비고

- 첫 인덱싱은 16K개라 수십 초~1분. 진행률 표시.
- exe는 서명 안 됨 → 공유 시 SmartScreen 1회 경고 가능(정상).
