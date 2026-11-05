# Clothing Swap Studio

제품 이미지를 참고해 배경 이미지 속 의상을 교체하는 로컬 데스크톱 앱입니다. 개발 원본은 항상 이 폴더에서 수정합니다.

## 다운로드

[Windows 설치 파일 다운로드](https://github.com/yuri09205/clothing-swap-studio/releases/latest) · [모든 버전 보기](https://github.com/yuri09205/clothing-swap-studio/releases)

다운로드 페이지의 `Assets`에서 `Clothing-Swap-Studio-Setup-<버전>.exe`를 선택해 설치합니다.

## 사용 설명서

처음 실행할 때 본인의 OpenAI API 키를 입력한 후 다음 순서로 사용합니다.

1. **01 배경 이미지**에 작업할 이미지를 첨부하거나 기본 배경 중 하나를 선택합니다.
2. 선택한 배경 이미지를 클릭한 뒤 **옷걸이 위치 설정**에서 교체할 의상의 위치를 지정합니다. 등록한 위치에만 새 의상이 적용됩니다.
3. **02 새 의상 이미지**에 교체할 제품의 누끼 이미지를 첨부합니다. 제품 이미지는 1~6장까지 사용할 수 있습니다.
4. **03 의상 교체 결과**의 **의상 교체하기** 버튼을 누릅니다.
5. 03에서 생성된 결과가 마음에 들면 **1920×1080 OUTPUT 저장** 버튼을 누릅니다. 결과는 사용자의 `문서/Clothing Swap Studio/02_OUTPUT/<날짜>` 폴더에 저장됩니다.
6. 03 결과에서 수정할 부분이 있다면 **04 수정 프롬프트 + 레퍼런스 이미지**에 수정 내용을 입력하고 필요한 참고 이미지를 첨부한 뒤 **이미지 생성** 버튼을 누릅니다. 수정된 결과는 **05 최종 이미지 수정 결과**에 표시됩니다.
7. **H 최근 생성 히스토리**에서는 03과 05에서 생성한 이미지를 최신순으로 최대 20개까지 확인할 수 있습니다.

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
