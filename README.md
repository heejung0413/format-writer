# 포맷 글 작성기

내용을 입력하고 포맷(메일, 채팅 등)을 고르면 Claude가 그 포맷에 맞는 글을 써 주는 개인용 웹사이트입니다. 내 컴퓨터에서만 실행합니다.

## 실행

```bash
npm install
npm run dev                  # http://localhost:3000
```

기본값은 이 컴퓨터에 로그인된 Claude Code 계정으로 Claude를 호출합니다. 터미널에서 `claude` 명령이 실행되고 로그인돼 있으면 따로 설정할 것이 없습니다. 사용량은 그 계정의 Claude Code 한도에서 나갑니다.

### API 키로 호출하기

```bash
cp .env.example .env.local
```

`.env.local`에 `CLAUDE_PROVIDER=api`와 `ANTHROPIC_API_KEY`를 넣고 서버를 다시 시작합니다. 키는 https://console.anthropic.com 에서 발급하며 크레딧 충전이 필요합니다.

## 쓰는 법

1. 포맷, 받는 사람, 말투를 고릅니다.
2. 내용을 적고 **작성하기**를 누릅니다.
3. 결과가 마음에 안 들면 **더 짧게** 같은 버튼이나 수정 지시로 다듬습니다.
4. **포맷 관리**에서 나만의 포맷을 추가합니다. 예시 글을 넣으면 그 구성을 따라 씁니다.

## 데이터

포맷과 작성 기록은 `data/formats.json`, `data/history.json`에 저장됩니다. 이 폴더와 `.env.local`은 git에 올라가지 않습니다.

## 개발

```bash
npm test            # 단위 테스트
npm run typecheck   # 타입 검사
```

모델을 바꾸려면 `.env.local`의 `CLAUDE_MODEL`에 모델 ID를 넣습니다. 기본값은 `claude-opus-5-5`입니다.
