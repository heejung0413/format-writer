import type { Format } from "./types";

export const RECIPIENTS = ["없음", "상사", "동료", "고객"] as const;
export const TONES = ["격식", "보통", "편하게"] as const;

export const DEFAULT_FORMATS: Format[] = [
  {
    id: "mail",
    name: "메일",
    instruction:
      "첫 줄에 '제목: ...'을 쓴다. 한 줄 띄우고 인사 → 본문 → 맺음말 순서로 쓴다. 본문은 용건부터 말하고, 요청 사항이 여러 개면 번호 목록으로 쓴다.",
  },
  {
    id: "chat",
    name: "채팅",
    instruction:
      "업무 메신저에 바로 보낼 수 있는 짧은 글로 쓴다. 제목과 인사말을 넣지 않고 3~5문장 안으로 끝낸다.",
  },
  {
    id: "report",
    name: "보고",
    instruction:
      "첫 줄에 결론을 한 문장으로 쓴다. 이어서 '현황', '문제', '다음 할 일'을 소제목과 짧은 불릿으로 정리한다.",
  },
];
