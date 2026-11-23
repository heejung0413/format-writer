import type { HistoryItem } from "@/lib/types";

type Props = {
  items: HistoryItem[];
  activeId: string | null;
  onSelect: (item: HistoryItem) => void;
  onDelete: (id: string) => void;
};

function formatDate(iso: string): string {
  const date = new Date(iso);
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${date.getMonth() + 1}/${date.getDate()} ${hh}:${mm}`;
}

export function HistoryList({ items, activeId, onSelect, onDelete }: Props) {
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-slate-200 bg-white">
      <h2 className="border-b border-slate-200 px-4 py-3 text-sm font-semibold">작성 기록</h2>
      {items.length === 0 ? (
        <p className="px-4 py-3 text-sm text-slate-400">아직 기록이 없습니다.</p>
      ) : (
        <ul className="flex-1 overflow-y-auto">
          {items.map((item) => (
            <li
              key={item.id}
              className={`group flex items-start gap-1 border-b border-slate-100 ${
                item.id === activeId ? "bg-blue-50" : "hover:bg-slate-50"
              }`}
            >
              <button
                type="button"
                className="min-w-0 flex-1 px-4 py-2 text-left"
                onClick={() => onSelect(item)}
              >
                <span className="block text-xs text-slate-500">
                  {formatDate(item.createdAt)} · {item.formatName}
                </span>
                <span className="block truncate text-sm">{item.input}</span>
              </button>
              <button
                type="button"
                aria-label="기록 삭제"
                className="px-2 py-2 text-slate-400 opacity-0 hover:text-red-600 group-hover:opacity-100"
                onClick={() => onDelete(item.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
