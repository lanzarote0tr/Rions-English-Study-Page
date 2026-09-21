# Rion's English Study Page

영어 지문을 필기, 글쓰기, 단어 채우기, 한줄 해석 방식으로 학습하는 Flask 웹 애플리케이션입니다.

## 실행

Python 3.12 이상을 권장합니다.

```bash
python -m venv venv
source venv/bin/activate
python -m pip install -r requirements.txt
flask --app app run --debug
```

운영 환경에서는 Flask 개발 서버 대신 Gunicorn을 사용합니다.

```bash
gunicorn --bind 0.0.0.0:5000 app:app
```

Docker로 실행할 수도 있습니다.

```bash
docker build -t rions-english-study .
docker run --rm -p 5000:5000 rions-english-study
```

## 학습 자료 형식

`texts/` 아래의 `.txt` 파일은 영어 문장과 한국어 해석을 한 줄씩 번갈아 저장합니다.
단어 채우기 문제로 사용할 단어는 `**단어**` 형식으로 표시합니다.

```text
Can I use the temporary parking lot?
임시 주차장을 이용할 수 있나요?
I would like to **request** a temporary parking space.
저는 임시 주차 공간을 요청하고 싶습니다.
```

웹 화면에서 만든 폴더와 텍스트는 서버가 아닌 현재 브라우저의 `localStorage`에만 저장됩니다.
학습 진도는 해당 탭의 `sessionStorage`에 저장됩니다.

필기가 기본 학습 탭입니다. 본문에서 원하는 부분을 먼저 선택한 뒤 빨간 밑줄, 노란 하이라이트, 네모 치기 버튼을 눌러 적용할 수 있습니다. 밑줄과 네모에는 같은 색의 작은 메모를 붙일 수 있습니다. 필기 내용은 현재 브라우저의 `localStorage`에 글별로 저장됩니다.

## 보조 스크립트

- `scripts/refine_text_files.py`: `texts/`의 영어 본문에서 핵심 단어를 다시 선정해 표시합니다. 원본 파일을 직접 수정하므로 실행 전에 별도 백업이나 버전 관리 상태를 확인하세요.
- `scripts/extract_mock_exam_texts.py`: PDF에서 모의고사 지문을 추출합니다. 시스템에 `pdftotext`가 필요합니다.
- `scripts/extract_filled_blanks_json.py`: 지정된 JSON 자료를 학습용 텍스트로 변환합니다.

## 검증

```bash
python -m unittest discover -s tests -v
python -m compileall -q app.py content.py scripts
node --check static/js/theme-init.js
node --check static/js/core.js
node --check static/js/select.js
node --check static/js/annotations.js
node --check static/js/study.js
node --check static/js/navigation.js
```
