# Clothing Swap Studio

제품 이미지를 참고해 배경 이미지 속 의상을 교체하는 로컬 데스크톱 앱입니다. 개발 원본은 항상 이 폴더에서 수정합니다.

## 개발 실행

```powershell
npm start
```

웹 버전은 `http://localhost:4175`에서 열립니다. Electron 데스크톱 창으로 확인하려면 다음 명령을 사용합니다.

```powershell
npm run electron:start
```

## Windows 릴리스 생성

1. `package.json`의 `version`을 새 버전으로 변경합니다.
2. 수정 전 주요 파일을 상위 `_ROLLBACK` 폴더에 백업합니다.
3. 아래 명령을 실행합니다.

```powershell
npm run release:windows
```

테스트가 통과하면 설치 파일이 자동으로 `../RELEASE/<버전>/Clothing-Swap-Studio-Setup-<버전>.exe`에 저장됩니다.

## 배포 앱의 데이터 위치

- 기본 배경: 설치 파일에 함께 포함된 `assets/backgrounds`
- 생성 결과: 사용자의 `문서/Clothing Swap Studio/02_OUTPUT/<날짜>`
- OpenAI API 키: 사용자가 실행 중 입력하며 서버 메모리에만 보관됩니다. 앱 종료 후 다시 입력해야 합니다.

제품 이미지는 1~6장까지 첨부할 수 있습니다. 이미지 생성은 OpenAI 이미지 API를 사용합니다.
