# Video to WebP Lab

로컬(브라우저)에서 동영상을 애니메이션 WebP로 변환하는 정적 웹앱입니다.  
서버 업로드 없이 `ffmpeg.wasm`으로 동작하며 GitHub Pages에 바로 배포할 수 있습니다.

## 주요 기능
- 동영상 파일 선택/드래그 앤 드롭
- 업로드한 원본 영상 실시간 미리보기
- 영상 위 드래그/핸들 기반 크롭 편집(숫자 입력과 동기화)
- 영상 재생 위치 기준 트림 지정(시작/종료 슬라이더 + 현재 위치 버튼)
- 트림(시작/종료 시간)
- 크롭(X, Y, W, H)
- 리사이즈(출력 너비/높이)
- FPS 조절(1~30)
- 품질 조절(1~100)
- FPS/품질 포함 현재 설정 3초 샘플 WebP 미리보기
- 원본 용량/변환 용량/용량 변화율 표시
- 변환 결과 미리보기 + 다운로드

## 지원 범위
- 공식 지원: Chrome, Edge 최신 2버전
- UI 언어: 한국어
- 처리 방식: 전부 브라우저 로컬 처리

## 로컬 실행
정적 파일만 있으면 되므로 아무 HTTP 서버나 사용 가능합니다.

```bash
# Python 3가 있는 경우
python3 -m http.server 4173
```

브라우저에서 `http://localhost:4173` 접속

## GitHub Pages 배포
이 저장소에는 GitHub Actions 기반 Pages 배포 워크플로(`.github/workflows/deploy.yml`)가 포함되어 있습니다.

1. GitHub 저장소에 푸시
2. GitHub 저장소 설정 > Pages
3. `Build and deployment`를 `GitHub Actions`로 선택
4. `main` 브랜치에 커밋이 올라가면 자동 배포

배포 워크플로는 실행 시 `assets/ffmpeg/`에 `@ffmpeg/ffmpeg`/`@ffmpeg/util` ESM 런타임과 `ffmpeg-core.js`/`ffmpeg-core.wasm`을 same-origin으로 배치합니다.

## 기술 스택
- Vanilla JavaScript
- ffmpeg.wasm (`@ffmpeg/ffmpeg`, `@ffmpeg/core`, `@ffmpeg/util`)
- 정적 HTML/CSS

## 주의사항
- 대용량 파일(200MB+)은 메모리와 기기 성능에 따라 실패할 수 있습니다.
- 브라우저 탭 메모리 제한에 영향을 받습니다.
- 변환 품질/용량은 입력 코덱과 설정에 따라 달라집니다.
