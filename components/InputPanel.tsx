type Props = {
  value: string;
  busy: boolean;
  canSubmit: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
};

export function InputPanel({ value, busy, canSubmit, onChange, onSubmit, onStop }: Props) {
  return (
    <div className="flex flex-col gap-2">
      <textarea
        className="h-40 w-full resize-y rounded-md border border-slate-300 bg-white p-3 text-sm"
        placeholder="전하고 싶은 내용을 편하게 적어 주세요. 메모나 요점만 적어도 됩니다."
        value={value}
        disabled={busy}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="flex justify-end">
        {busy ? (
          <button
            type="button"
            className="rounded-md bg-slate-600 px-4 py-2 text-sm text-white hover:bg-slate-700"
            onClick={onStop}
          >
            중단
          </button>
        ) : (
          <button
            type="button"
            className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-40"
            disabled={!canSubmit}
            onClick={onSubmit}
          >
            작성하기
          </button>
        )}
      </div>
    </div>
  );
}
