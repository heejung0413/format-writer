import { LENGTHS, RECIPIENTS, TONES } from "@/lib/defaults";
import type { Format } from "@/lib/types";

type Props = {
  formats: Format[];
  formatId: string;
  recipient: string;
  tone: string;
  length: string;
  disabled: boolean;
  onFormatChange: (id: string) => void;
  onRecipientChange: (value: string) => void;
  onToneChange: (value: string) => void;
  onLengthChange: (value: string) => void;
  onManage: () => void;
};

const selectClass =
  "rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm disabled:opacity-50";

export function OptionBar(props: Props) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-1.5 text-sm">
        포맷
        <select
          className={selectClass}
          value={props.formatId}
          disabled={props.disabled}
          onChange={(e) => props.onFormatChange(e.target.value)}
        >
          {props.formats.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1.5 text-sm">
        받는 사람
        <select
          className={selectClass}
          value={props.recipient}
          disabled={props.disabled}
          onChange={(e) => props.onRecipientChange(e.target.value)}
        >
          {RECIPIENTS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1.5 text-sm">
        말투
        <select
          className={selectClass}
          value={props.tone}
          disabled={props.disabled}
          onChange={(e) => props.onToneChange(e.target.value)}
        >
          {TONES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1.5 text-sm">
        길이
        <select
          className={selectClass}
          value={props.length}
          disabled={props.disabled}
          onChange={(e) => props.onLengthChange(e.target.value)}
        >
          {LENGTHS.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="ml-auto rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-100"
        onClick={props.onManage}
      >
        포맷 관리
      </button>
    </div>
  );
}
