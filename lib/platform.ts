import { useSyncExternalStore } from "react";

const noSubscription = () => () => {};

function isApplePlatform(): boolean {
  const platform = typeof navigator.platform === "string" ? navigator.platform : "";
  return /Mac|iPhone|iPad|iPod/i.test(platform);
}

/**
 * 단축키 표시용 수정키 이름. 서버가 미리 그린 화면과 맞추려고 서버에서는 항상 "Ctrl"을 돌려주고,
 * 브라우저에서는 처음 그린 뒤에 실제 플랫폼 값으로 바뀐다(하이드레이션 불일치 없음).
 */
export function useIsMac(): boolean {
  return useSyncExternalStore(noSubscription, isApplePlatform, () => false);
}
