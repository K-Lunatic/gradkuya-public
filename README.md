# 졸업할KU야 · GradKUya

성적표와 입학연도 요람을 대조해 남은 졸업요건을 확인하고, 들을 과목을 시간표로 조합하는 도구입니다.

**[가상 성적표 결과 보기](https://k-lunatic.github.io/Foundation/gradkuya/)** — 파일 업로드 없이 예제 과목과 졸업요건 계산 결과를 확인할 수 있습니다.

## 실행

Node.js 22 이상과 pnpm을 사용합니다.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

브라우저에서 [localhost:3000](http://localhost:3000)을 엽니다. 성적표 PDF 파싱과 졸업요건·시간표 검사는 `pnpm check`로 실행합니다. 버그 제보 연동을 사용할 때만 서버 환경변수 `BUG_REPORT_DISCORD_WEBHOOK_URL`을 설정합니다.

## 배포 자료

학교 요람 원문·추출본은 포함하지 않습니다. 가상 요람은 기능 재현용으로만 제공하며 실제 졸업 판정에 사용할 수 없습니다. 테스트의 개인 식별값은 가상 값으로 교체했습니다.

[MIT 라이선스](LICENSE) · [외부 자료 안내](THIRD_PARTY_NOTICES.md)

[개발 기록](DEVELOPMENT.md)
